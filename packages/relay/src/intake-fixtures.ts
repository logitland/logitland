// Shared by the intake, scrub, read and retention tests (not a test file itself).

import { newId } from '@logitland/contracts';
import { agree } from './consent.testkit';
import { accessFor } from './services/channels';
import { DIGEST_MAX, readFeed, stillReadable, type SubscriptionRow } from './services/feed';
import { ingest, type IntakeEventInput } from './services/intake';
import { BENCH, FORUM, LOUNGE, harness, seedAgent, seedChannel, type Harness } from './testing';

export const HUMAN = '200000000000000001';
/** Someone who never agrees: whatever they write is dropped. */
export const STRANGER = '200000000000000002';
export const WEBHOOK = '600000000000000001';
/** The agent's message in #lounge that `world()` stores before the fixtures' messages, and that `human()` replies to. */
export const AGENT_POST = '299000000000000001';

/** Snowflakes in time order, 18 digits. */
export const msg = (n: number) => String(300000000000000000n + BigInt(n));
export const at = (minutes: number, seconds = 0) => new Date(Date.UTC(2026, 9, 19, 3, minutes, seconds)).toISOString();

/** A person's message. It replies to AGENT_POST, since intake keeps a person's message only as a reply to an agent; pass `reply_to: null` for one it drops. */
export function human(n: number, over: Record<string, unknown> = {}) {
  return {
    kind: 'message_create' as const,
    channel_id: LOUNGE,
    message_id: msg(n),
    author: { id: HUMAN, username: 'luna', global_name: 'Luna', bot: false },
    content: `message ${n}`,
    timestamp: at(0, n),
    reply_to: AGENT_POST,
    ...over,
  } satisfies IntakeEventInput;
}

export function fromWebhook(n: number, username: string, content: string, over: Record<string, unknown> = {}) {
  return {
    kind: 'message_create' as const,
    channel_id: LOUNGE,
    message_id: msg(n),
    author: { id: WEBHOOK, username, bot: true, webhook_id: WEBHOOK },
    content,
    timestamp: at(0, n),
    ...over,
  } satisfies IntakeEventInput;
}

export const edit = (n: number, content: string | undefined, minute: number, over: Record<string, unknown> = {}) =>
  ({
    kind: 'message_update' as const,
    channel_id: LOUNGE,
    message_id: msg(n),
    ...(content === undefined ? {} : { content }),
    edited_timestamp: at(minute),
    ...over,
  }) satisfies IntakeEventInput;

export const remove = (n: number, over: Record<string, unknown> = {}) =>
  ({ kind: 'message_delete' as const, channel_id: LOUNGE, message_id: msg(n), ...over }) satisfies IntakeEventInput;

export const push = (h: Harness, ...events: unknown[]) => ingest(h.relay, { source: 'test', events });

export function stranger(n: number, over: Record<string, unknown> = {}) {
  return human(n, { author: { id: STRANGER, username: 'sam', global_name: 'Sam', bot: false }, ...over });
}

/**
 * A relay with an open channel (#lounge, with a webhook), a closed one (#bench), one agent and its message AGENT_POST in
 * #lounge (stored directly: no event). HUMAN agreed before any of the fixtures' messages.
 */
export async function world(opts: { start?: string; agreed?: boolean } = {}) {
  const h = harness(opts.start ? { start: opts.start } : {});
  if (opts.agreed !== false) await agree(h, HUMAN);
  await seedChannel(h.relay, { id: LOUNGE, access: 'post' });
  await seedChannel(h.relay, { id: BENCH, access: 'off', name: 'bench', webhookUrl: null });
  const agent = await seedAgent(h.relay, { name: 'Moth-9' });
  await h.db
    .prepare(
      "INSERT INTO conversation (message_id, channel_id, author_kind, agent_id, author_ref, display_name, content, created_at) VALUES (?, ?, 'agent', ?, ?, ?, 'hello, people', ?)",
    )
    .bind(AGENT_POST, LOUNGE, agent.id, agent.id, agent.name, '2026-10-19T02:59:00.000Z')
    .run();
  return { h, agent };
}

/** A live subscription to a channel from the log's tail, inserted directly (the subscribe endpoint checks access first). */
export async function subscribe(h: Harness, agentId: string, channelId = LOUNGE) {
  const id = newId('subscription');
  await h.db
    .prepare(
      "INSERT INTO subscriptions (id, agent_id, kind, channel_id, frequency, frequency_seconds, cursor, created_at, updated_at) VALUES (?, ?, 'channel', ?, 'live', 0, (SELECT COALESCE(MAX(seq), 0) FROM events), ?, ?)",
    )
    .bind(id, agentId, channelId, h.now().toISOString(), h.now().toISOString())
    .run();
  return id;
}

/** The types of the events a subscription has waiting after its cursor (what its next digests would carry), without taking them. */
export async function waiting(h: Harness, subscriptionId: string): Promise<string[]> {
  const sub = (await h.db
    .prepare('SELECT s.*, a.level, a.owner_id FROM subscriptions s JOIN agents a ON a.id = s.agent_id WHERE s.id = ?')
    .bind(subscriptionId)
    .first<SubscriptionRow & { level: number; owner_id: string | null }>())!;
  const readable = await stillReadable(h.relay, sub, await accessFor(h.relay, sub));
  return (await readFeed(h.relay, sub, sub.cursor, DIGEST_MAX, readable)).events.map((e) => e.type);
}

export async function all<T>(h: Harness, sql: string, ...args: unknown[]): Promise<T[]> {
  return (
    await h.db
      .prepare(sql)
      .bind(...args)
      .all<T>()
  ).results;
}

export async function one<T>(h: Harness, sql: string, ...args: unknown[]): Promise<T | null> {
  return h.db
    .prepare(sql)
    .bind(...args)
    .first<T>();
}

export const CONV =
  'CAST(message_id AS TEXT) AS message_id, channel_id, thread_id, author_kind, agent_id, author_ref, discord_user_id, display_name, content, relay_message_id, created_at, edited_at, deleted_at, removed_by, reply_to';

export const conversation = (h: Harness, n: number) => one<Record<string, any>>(h, `SELECT ${CONV} FROM conversation WHERE message_id = ?`, msg(n));
export const eventTypes = async (h: Harness) => (await all<{ type: string }>(h, 'SELECT type FROM events ORDER BY seq')).map((e) => e.type);

/** Inserts a relay_messages row the way the posting pipeline leaves it mid-send. */
export async function relayMessage(
  h: Harness,
  agentId: string,
  opts: { content: string; status?: string; channel?: string; createdAt?: string; discordMessageId?: string | null; hash: string },
) {
  const id = newId('message');
  const when = opts.createdAt ?? h.now().toISOString();
  await h.db
    .prepare(
      'INSERT INTO relay_messages (id, agent_id, channel_id, content, status, discord_message_id, idempotency_key, payload_digest, content_hash, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    )
    .bind(
      id,
      agentId,
      opts.channel ?? LOUNGE,
      opts.content,
      opts.status ?? 'sending',
      opts.discordMessageId ?? null,
      `key-${id}`,
      'digest',
      opts.hash,
      when,
      when,
    )
    .run();
  return id;
}

/* ---------- threads and replies ---------- */

export const NEWS = '110000000000000005';
export const MEDIA = '110000000000000004';

/** An announcement channel, a forum and a media channel next to #lounge (open to agents, no webhooks needed for reading). */
export async function moreChannels(h: Harness) {
  await seedChannel(h.relay, { id: FORUM, name: 'forum', type: 'forum', access: 'post', webhookUrl: null });
  await seedChannel(h.relay, { id: MEDIA, name: 'gallery', type: 'media', access: 'read_only', webhookUrl: null });
  await seedChannel(h.relay, { id: NEWS, name: 'news', type: 'announcement', access: 'read_only', webhookUrl: null });
}

export const thread = (id: string, parent = LOUNGE, over: Record<string, unknown> = {}) =>
  ({
    kind: 'thread_upsert' as const,
    thread_id: id,
    parent_id: parent,
    name: 'a thread',
    created_at: at(0, 5),
    archived: false,
    locked: false,
    ...over,
  }) satisfies IntakeEventInput;

export const THREAD_COLUMNS =
  'CAST(id AS TEXT) AS id, parent_id, name, created_at, archived, locked, deleted_at, message_count, last_message_at, creator_agent_id, applied_tags';

export const threadRow = (h: Harness, id: string) => one<Record<string, any>>(h, `SELECT ${THREAD_COLUMNS} FROM threads WHERE id = ?`, id);
