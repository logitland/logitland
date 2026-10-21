import type { Digest, Frequency, RelayEvent, SubscriptionKind } from '@logitland/contracts';
import { iso, type Relay, type Stmt } from '../context';
import { accessFor, listChannels, type Viewer } from './channels';
import { withdrawnSql } from './conversation';
import { eventTail } from './events';
import { hit, peek } from './limits';

// Delivery as a pull from the event log (#11, #23, #30 Q4). Each subscription keeps a cursor (the last event it was given);
// a digest is the next events after it, at most 100. Webhooks, long-poll and WebSocket all take digests the same way, so
// one subscription is never ahead on one transport and behind on another.

/** A digest carries at most this many events; `more` says there are others waiting. */
export const DIGEST_MAX = 100;

export const FREQUENCY_SECONDS: Record<Frequency, number> = {
  live: 0,
  '2s': 2,
  '5s': 5,
  '10s': 10,
  '15s': 15,
  '30s': 30,
  '60s': 60,
  '2m': 120,
  '5m': 300,
  '10m': 600,
  '15m': 900,
  '30m': 1800,
  '60m': 3600,
  '2h': 7200,
  '3h': 10_800,
  '6h': 21_600,
  '12h': 43_200,
  '24h': 86_400,
  '36h': 129_600,
  '2d': 172_800,
  '3d': 259_200,
  '7d': 604_800,
};

export interface SubscriptionRow {
  id: string;
  agent_id: string;
  kind: SubscriptionKind;
  channel_id: string | null;
  frequency: Frequency;
  frequency_seconds: number;
  include_own: number;
  cursor: number;
  next_due_ms: number | null;
  last_delivered_ms: number | null;
  ended_at: string | null;
  created_at: string;
  updated_at: string;
}

/** Removals go to whoever might hold the text, even after the channel closed to them, and so does the channel's end. */
const REMOVALS = "e.type IN ('message.deleted', 'message.bulk_deleted', 'channel.deleted')";

/**
 * A bulk removal that takes away a reply to the agent (one parameter, its ID). A single removal names the agent in
 * reply_agent_id; a bulk one (a person withdrawing, a Discord bulk delete) can hold replies to many agents.
 */
const BULK_REPLY = `(e.type = 'message.bulk_deleted' AND EXISTS (SELECT 1 FROM json_each(e.payload, '$.data.message_ids') j
  JOIN conversation c ON c.message_id = CAST(j.value AS INTEGER) JOIN conversation p ON p.message_id = c.reply_to WHERE p.agent_id = ?))`;

/**
 * The channels an agent may read now, as a JSON array for SQL: what its channel and replies subscriptions may still
 * deliver. Removals go to it either way.
 */
export async function readableChannels(relay: Relay, viewer: Viewer): Promise<string> {
  const access = await accessFor(relay, viewer);
  return JSON.stringify((await listChannels(relay)).filter((r) => access(r).read).map((r) => r.id));
}

/**
 * Which events belong to a subscription, as SQL over `events e`. A channel subscription: the channel's events, its own posts
 * only with include_own. Replies: replies to the agent's messages by others, and the events addressed to the agent
 * (message.status, conversation.invited). Conversation: the events of the private conversations the agent joined, and
 * removals in the ones it left; no other kind sees those (#33). In a channel the agent can no longer read (`readable`, from
 * readableChannels) only removals reach it; a deleted channel's subscription still gets its last events. A person who
 * withdrew takes their words back, even before the clean-up reaches their events. The events_due trigger in the migration
 * says the same for what is due.
 */
function belongs(sub: SubscriptionRow, readable: string): { sql: string; args: unknown[] } {
  const words = `NOT (e.type IN ('message.created', 'message.updated') AND EXISTS (SELECT 1 FROM conversation c WHERE c.message_id = e.message_id AND ${withdrawnSql('c')}))`;
  const own = '(? = 1 OR e.author_agent_id IS NULL OR e.author_agent_id != ?)';
  const read = `(e.channel_id IN (SELECT value FROM json_each(?)) OR ${REMOVALS})`;
  // The first OR picks the rows by index (events_for_agent, events_replies, events_bulk); the rest decides.
  if (sub.kind === 'replies')
    return {
      sql: `(e.agent_id = ? OR e.reply_agent_id = ? OR e.type = 'message.bulk_deleted') AND e.silent = 0
        AND (e.agent_id = ? OR (e.private_thread_id IS NULL AND (e.author_agent_id IS NULL OR e.author_agent_id != ?)
          AND (e.reply_agent_id = ? OR ${BULK_REPLY}) AND ${read})) AND ${words}`,
      args: [sub.agent_id, sub.agent_id, sub.agent_id, sub.agent_id, sub.agent_id, sub.agent_id, readable],
    };
  if (sub.kind === 'conversation')
    return {
      sql: `e.private_thread_id IN (SELECT m.thread_id FROM conversation_members m WHERE m.agent_id = ? AND m.joined_at IS NOT NULL AND (m.left_at IS NULL OR ${REMOVALS}))
        AND e.agent_id IS NULL AND e.silent = 0 AND ${own} AND ${words}`,
      args: [sub.agent_id, sub.include_own, sub.agent_id],
    };
  if (sub.ended_at)
    return {
      sql: `e.channel_id = ? AND e.agent_id IS NULL AND e.private_thread_id IS NULL AND e.silent = 0 AND ${own} AND ${words}`,
      args: [sub.channel_id, sub.include_own, sub.agent_id],
    };
  return {
    sql: `e.channel_id = ? AND e.agent_id IS NULL AND e.private_thread_id IS NULL AND e.silent = 0 AND ${own} AND ${words} AND ${read}`,
    args: [sub.channel_id, sub.include_own, sub.agent_id, readable],
  };
}

const toEvent = (row: { seq: number; payload: string }) => ({ ...JSON.parse(row.payload), cursor: String(row.seq) }) as RelayEvent;

/**
 * A page of a subscription's events after `after`, oldest first, for an agent that may read `readable` (readableChannels).
 * `last` is how far the page reached: with nothing more, the log's tail when it was read, so events that didn't belong to
 * the subscription are never looked at again.
 */
export async function readFeed(
  relay: Relay,
  sub: SubscriptionRow,
  after: number,
  limit: number,
  readable: string,
): Promise<{ events: RelayEvent[]; last: number; more: boolean }> {
  // The tail first: anything committed before it is visible to the query, so nothing up to it can be missed.
  const tail = await eventTail(relay);
  const where = belongs(sub, readable);
  const { results } = await relay.db
    .prepare(`SELECT e.seq, e.payload FROM events e WHERE e.seq > ? AND e.seq <= ? AND ${where.sql} ORDER BY e.seq LIMIT ?`)
    .bind(after, tail, ...where.args, limit + 1)
    .all<{ seq: number; payload: string }>();
  const page = results.slice(0, limit);
  const more = results.length > limit;
  return {
    events: page.map(toEvent),
    last: more ? page[page.length - 1]!.seq : Math.max(tail, after),
    more,
  };
}

/** How many events wait after the subscription's cursor, counted up to DIGEST_MAX. */
export async function countWaiting(relay: Relay, sub: SubscriptionRow, readable: string): Promise<number> {
  const where = belongs(sub, readable);
  const row = await relay.db
    .prepare(`SELECT COUNT(*) AS n FROM (SELECT 1 FROM events e WHERE e.seq > ? AND ${where.sql} LIMIT ?)`)
    .bind(sub.cursor, ...where.args, DIGEST_MAX)
    .first<{ n: number }>();
  return row?.n ?? 0;
}

/**
 * A statement committed in one transaction with a digest's cursor move, ahead of it (a webhook delivery's row). It must
 * check that the subscription's cursor is still `from`, so it takes effect exactly when the move does.
 */
export type Handoff = (digest: Digest, from: number) => Stmt;

/**
 * Takes the next digest off a subscription and moves its cursor past it, or null when there is nothing (or another taker
 * got there first: the move is a compare-and-set on the cursor). Clearing `next_due_ms` checks the log again in the same
 * statement, so an event recorded while this ran keeps the subscription due.
 */
async function take(relay: Relay, sub: SubscriptionRow, readable: string, handoff?: Handoff): Promise<Digest | null> {
  const nowMs = relay.now().getTime();
  const page = await readFeed(relay, sub, sub.cursor, DIGEST_MAX, readable);
  const rest = belongs(sub, readable);
  const pending = `EXISTS (SELECT 1 FROM events e WHERE e.seq > ? AND ${rest.sql})`;
  if (!page.events.length) {
    if (sub.ended_at) await relay.db.prepare('DELETE FROM subscriptions WHERE id = ? AND cursor = ?').bind(sub.id, sub.cursor).run();
    else
      await relay.db
        .prepare(`UPDATE subscriptions SET cursor = ?, next_due_ms = CASE WHEN ${pending} THEN next_due_ms ELSE NULL END WHERE id = ? AND cursor = ?`)
        .bind(page.last, page.last, ...rest.args, sub.id, sub.cursor)
        .run();
    return null;
  }
  const digest: Digest = {
    type: 'digest',
    subscription_id: sub.id as Digest['subscription_id'],
    events: page.events,
    cursor: String(page.last),
    more: page.more,
  };
  const move = relay.db
    .prepare(
      `UPDATE subscriptions SET cursor = ?, last_delivered_ms = ?, updated_at = ?,
         next_due_ms = CASE WHEN ${pending} THEN MAX(?, ? + frequency_seconds * 1000) ELSE NULL END
       WHERE id = ? AND cursor = ?`,
    )
    .bind(page.last, nowMs, iso(relay.now()), page.last, ...rest.args, nowMs, nowMs, sub.id, sub.cursor);
  const moved = handoff ? (await relay.db.batch([handoff(digest, sub.cursor), move]))[1]! : await move.run();
  return moved.meta.changes === 0 ? null : digest;
}

/**
 * A stored digest as it may be sent now: its events read again from the log, so whatever happened since it was taken (a
 * removal, a person withdrawing, the agent leaving a conversation or losing a channel) applies to it too. A subscription
 * that is gone still owes its removals. Null when nothing in it may go.
 */
export async function refreshDigest(relay: Relay, agentId: string, body: string): Promise<string | null> {
  const digest = JSON.parse(body) as Digest;
  const [sub, viewer] = await Promise.all([
    relay.db.prepare('SELECT * FROM subscriptions WHERE id = ?').bind(digest.subscription_id).first<SubscriptionRow>(),
    relay.db.prepare('SELECT level, owner_id FROM agents WHERE id = ?').bind(agentId).first<Viewer>(),
  ]);
  const where = sub && viewer ? belongs(sub, await readableChannels(relay, viewer)) : { sql: REMOVALS, args: [] };
  const { results } = await relay.db
    .prepare(`SELECT e.seq, e.payload FROM events e WHERE e.seq IN (SELECT value FROM json_each(?)) AND ${where.sql} ORDER BY e.seq`)
    .bind(JSON.stringify(digest.events.map((e) => Number(e.cursor))), ...where.args)
    .all<{ seq: number; payload: string }>();
  return results.length ? JSON.stringify({ ...digest, events: results.map(toEvent) } satisfies Digest) : null;
}

/** Events an agent was given today (UTC), against its owner's daily cap (#24). The window is a UTC day, so it resets at midnight. */
const deliveredToday = (agentId: string) => ({ key: `delivered:${agentId}:d`, limit: Number.MAX_SAFE_INTEGER, windowSeconds: 86_400 });

export async function countDeliveredToday(relay: Relay, agentId: string): Promise<number> {
  return peek(relay, deliveredToday(agentId));
}

const nextUtcMidnight = (now: Date) => Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1);

/**
 * Takes digests for an agent: the subscriptions that are due (`due`, for pushes), or every one with something waiting
 * (a long-poll, which reads whenever it is asked). Past the owner's daily cap, everything waits for one digest after
 * midnight UTC, and `capped` says so. A `handoff` commits with each cursor move.
 */
export async function takeDigests(
  relay: Relay,
  agent: Viewer & { id: string; daily_event_cap: number | null },
  mode: 'due' | 'all',
  handoff?: Handoff,
): Promise<{ digests: Digest[]; capped: boolean }> {
  const now = relay.now();
  if (agent.daily_event_cap !== null && (await countDeliveredToday(relay, agent.id)) >= agent.daily_event_cap) {
    await relay.db
      .prepare('UPDATE subscriptions SET next_due_ms = ? WHERE agent_id = ? AND next_due_ms IS NOT NULL AND next_due_ms < ?')
      .bind(nextUtcMidnight(now), agent.id, nextUtcMidnight(now))
      .run();
    return { digests: [], capped: true };
  }
  const { results: subs } = await relay.db
    .prepare(`SELECT * FROM subscriptions WHERE agent_id = ? ${mode === 'due' ? 'AND next_due_ms <= ?' : ''} ORDER BY kind DESC, created_at`)
    .bind(agent.id, ...(mode === 'due' ? [now.getTime()] : []))
    .all<SubscriptionRow>();
  if (!subs.length) return { digests: [], capped: false };
  const readable = await readableChannels(relay, agent);
  const digests: Digest[] = [];
  for (const sub of subs) {
    const digest = await take(relay, sub, readable, handoff);
    if (digest) digests.push(digest);
  }
  const count = digests.reduce((n, d) => n + d.events.length, 0);
  if (count) await hit(relay, deliveredToday(agent.id), count);
  return { digests, capped: false };
}
