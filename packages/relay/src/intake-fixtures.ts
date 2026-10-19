// Shared by the intake, scrub, read and retention tests (not a test file itself).

import { newId } from '@logitland/contracts';
import { agree } from './consent.testkit';
import { ingest, type IntakeEventInput } from './services/intake';
import { BENCH, FORUM, LOUNGE, harness, seedAgent, seedChannel, type Harness } from './testing';

export const HUMAN = '200000000000000001';
/** Someone who never agrees to the mirror: whatever they write is withheld. */
export const STRANGER = '200000000000000002';
export const WEBHOOK = '600000000000000001';

/** Snowflakes in time order, 18 digits. */
export const msg = (n: number) => String(300000000000000000n + BigInt(n));
export const at = (minutes: number, seconds = 0) => new Date(Date.UTC(2026, 9, 19, 3, minutes, seconds)).toISOString();

export function human(n: number, over: Record<string, unknown> = {}) {
  return {
    kind: 'message_create' as const,
    channel_id: LOUNGE,
    message_id: msg(n),
    author: { id: HUMAN, username: 'luna', global_name: 'Luna', bot: false },
    content: `message ${n}`,
    timestamp: at(0, n),
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

/** A relay with an open channel (#lounge, with a webhook), a closed one (#bench) and one agent. HUMAN agreed to the mirror before any of the fixtures' messages. */
export async function world(opts: { start?: string; agreed?: boolean } = {}) {
  const h = harness(opts.start ? { start: opts.start } : {});
  if (opts.agreed !== false) await agree(h, HUMAN);
  await seedChannel(h.relay, { id: LOUNGE, access: 'post' });
  await seedChannel(h.relay, { id: BENCH, access: 'off', name: 'bench', webhookUrl: null });
  const agent = await seedAgent(h.relay, { name: 'Moth-9' });
  return { h, agent };
}

/** An active subscription to a channel, so fan-out creates a delivery row for each event it wants. */
export async function subscribe(
  h: Harness,
  agentId: string,
  channelId = LOUNGE,
  events = ['message.created', 'message.updated', 'message.deleted', 'message.bulk_deleted', 'subscription.gap'],
) {
  const id = newId('subscription');
  await h.db
    .prepare(
      "INSERT INTO subscriptions (id, agent_id, url_ciphertext, url_host, events, channel_ids, description, secret_ciphertext, status, created_at) VALUES (?, ?, 'sealed', 'hooks.orrery.dev', ?, ?, NULL, 'sealed', 'active', ?)",
    )
    .bind(id, agentId, JSON.stringify(events), JSON.stringify([channelId]), h.now().toISOString())
    .run();
  await h.db.prepare('INSERT INTO subscription_channels (subscription_id, channel_id) VALUES (?, ?)').bind(id, channelId).run();
  return id;
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
  'CAST(message_id AS TEXT) AS message_id, channel_id, thread_id, author_kind, agent_id, author_ref, discord_user_id, display_name, content, relay_message_id, created_at, edited_at, deleted_at, removed_by, reply_to, poll, withheld';

export const conversation = (h: Harness, n: number) => one<Record<string, any>>(h, `SELECT ${CONV} FROM conversation WHERE message_id = ?`, msg(n));
export const eventTypes = async (h: Harness) => (await all<{ type: string }>(h, 'SELECT type FROM events ORDER BY seq')).map((e) => e.type);
export const deliveryCount = async (h: Harness) => (await one<{ n: number }>(h, 'SELECT COUNT(*) AS n FROM deliveries'))!.n;

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

/* ---------- threads, replies, polls ---------- */

export const NEWS = '110000000000000005';
export const MEDIA = '110000000000000004';

/** An announcement channel, a forum and a media channel next to #lounge (open to agents, no webhooks needed for reading). */
export async function moreChannels(h: Harness) {
  await seedChannel(h.relay, { id: FORUM, name: 'forum', type: 'forum', access: 'post_new_threads', webhookUrl: null });
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

export const poll = (over: Record<string, unknown> = {}) => ({
  question: 'Lunch?',
  answers: [
    { id: 1, text: 'Soup', emoji: null },
    { id: 2, text: 'Noodles', emoji: null },
  ],
  expires_at: '2026-10-20T03:00:00.000Z',
  allow_multiselect: false,
  ...over,
});
