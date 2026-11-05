import type { Digest, Frequency, RelayEvent, SubscriptionKind } from '@logitland/contracts';
import { iso, readAll, type Relay, type Stmt } from '../context';
import type { Access } from './access';
import { accessWith, listChannelsStmt, type ChannelRow, type Viewer } from './channels';
import { eventTailStmt } from './events';
import { hit, peek } from './limits';
import { resolveMentions } from './mentions';

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
  /** Replies after this seq, up to the cursor, that a deleted replies subscription never delivered (unsubscribe); null for none. */
  owed_after: number | null;
  ended_at: string | null;
  created_at: string;
  updated_at: string;
}

/** Removals go to whoever might hold the text, even after the channel closed to them, and so does the channel's end. */
const REMOVALS = "e.type IN ('message.deleted', 'message.bulk_deleted', 'channel.deleted')";

/**
 * A bulk removal that takes away a reply to the agent (one parameter, its ID). A single removal names the agent in
 * reply_agent_id; a bulk one (a Discord bulk delete) can hold replies to many agents.
 */
const BULK_REPLY = `(e.type = 'message.bulk_deleted' AND EXISTS (SELECT 1 FROM json_each(e.payload, '$.data.message_ids') j
  JOIN conversation c ON c.message_id = CAST(j.value AS INTEGER) JOIN conversation p ON p.message_id = c.reply_to WHERE p.agent_id = ?))`;

/**
 * The channels an agent may read now, as a JSON array for SQL: what its channel and replies subscriptions may still
 * deliver. Removals go to it either way.
 */
export async function readableChannels(relay: Relay, viewer: Viewer): Promise<string> {
  const { accessOf, rows } = await accessWith<[ChannelRow]>(relay, listChannelsStmt(relay));
  return readableIn(rows[0], accessOf(viewer));
}

/** readableChannels, for channels and access already read (accessWith). */
export const readableIn = (channels: ChannelRow[], access: (row: ChannelRow) => Access): string =>
  JSON.stringify(channels.filter((r) => access(r).read).map((r) => r.id));

/**
 * Which events belong to a subscription, as SQL over `events e`. A channel subscription: the channel's events, its own posts
 * only with include_own. Replies: replies to the agent's messages by others, and the events addressed to the agent
 * (message.status, conversation.invited, bot.struck). Conversation: the events of the private conversations the agent joined, and
 * removals in the ones it left; no other kind sees those (#33). In a channel the agent can no longer read (`readable`, from
 * readableChannels) only removals reach it; a deleted channel's subscription still gets its last events. The events_due
 * trigger in the migration says the same for what is due.
 */
function belongs(sub: SubscriptionRow, readable: string): { sql: string; args: unknown[] } {
  const own = '(? = 1 OR e.author_agent_id IS NULL OR e.author_agent_id != ?)';
  const read = `(e.channel_id IN (SELECT value FROM json_each(?)) OR ${REMOVALS})`;
  // The first OR picks the rows by index (events_for_agent, events_replies, events_bulk); the rest decides.
  if (sub.kind === 'replies')
    return {
      sql: `(e.agent_id = ? OR e.reply_agent_id = ? OR e.type = 'message.bulk_deleted') AND e.silent = 0
        AND (e.agent_id = ? OR (e.private_thread_id IS NULL AND (e.author_agent_id IS NULL OR e.author_agent_id != ?)
          AND (e.reply_agent_id = ? OR ${BULK_REPLY}) AND ${read}))`,
      args: [sub.agent_id, sub.agent_id, sub.agent_id, sub.agent_id, sub.agent_id, sub.agent_id, readable],
    };
  if (sub.kind === 'conversation')
    return {
      sql: `e.private_thread_id IN (SELECT m.thread_id FROM conversation_members m WHERE m.agent_id = ? AND m.joined_at IS NOT NULL AND (m.left_at IS NULL OR ${REMOVALS}))
        AND e.agent_id IS NULL AND e.silent = 0 AND ${own}`,
      args: [sub.agent_id, sub.include_own, sub.agent_id],
    };
  if (sub.ended_at)
    return {
      sql: `e.channel_id = ? AND e.agent_id IS NULL AND e.private_thread_id IS NULL AND e.silent = 0 AND ${own}`,
      args: [sub.channel_id, sub.include_own, sub.agent_id],
    };
  // A replies subscription brings replies to the agent's messages; channel subscriptions skip only the events a
  // replies subscription carried or would carry — recorded after one started, not written by the agent itself, and not
  // already delivered by a since-deleted one (reply_handoffs).
  const notReplies = `AND (e.reply_agent_id IS NULL OR e.reply_agent_id != ? OR (e.author_agent_id IS NOT NULL AND e.author_agent_id = ?)
    OR (NOT EXISTS (SELECT 1 FROM subscriptions r WHERE r.agent_id = ? AND r.kind = 'replies' AND r.ended_at IS NULL AND e.seq > r.start_seq)
      AND NOT EXISTS (SELECT 1 FROM reply_handoffs h WHERE h.agent_id = ? AND e.seq > h.from_seq AND e.seq <= h.to_seq)))`;
  return {
    sql: `e.channel_id = ? AND e.agent_id IS NULL AND e.private_thread_id IS NULL AND e.silent = 0 AND ${own} AND ${read} ${notReplies}`,
    args: [sub.channel_id, sub.include_own, sub.agent_id, readable, sub.agent_id, sub.agent_id, sub.agent_id, sub.agent_id],
  };
}

/** Where a subscription reads next: after its cursor, plus any owed replies after owed_after (unsubscribe). */
type Position = Pick<SubscriptionRow, 'cursor' | 'owed_after'>;

/**
 * The events ahead of a position, as SQL over `events e`, to AND with belongs: those after the cursor, and with replies
 * owed, the replies to the agent by others after owed_after. Owed replies sit behind the cursor, so they come first.
 */
function ahead(sub: SubscriptionRow, at: Position): { sql: string; args: unknown[] } {
  if (at.owed_after === null) return { sql: 'e.seq > ?', args: [at.cursor] };
  return {
    sql: 'e.seq > ? AND (e.seq > ? OR (e.reply_agent_id = ? AND (e.author_agent_id IS NULL OR e.author_agent_id != ?)))',
    args: [at.owed_after, at.cursor, sub.agent_id, sub.agent_id],
  };
}

/**
 * Matches a subscription's row (`subscriptions`) only while it is where `sub` was read. A take's cursor move and the
 * statements that commit with it check this, so a take read before another move or an unsubscribe can't commit.
 */
const unmoved = (sub: SubscriptionRow): { sql: string; args: unknown[] } => ({
  sql: 'id = ? AND cursor = ? AND owed_after IS ?',
  args: [sub.id, sub.cursor, sub.owed_after],
});

type EventRow = { seq: number; payload: string };

/**
 * Stored events as they are served: with their cursor, and messages with the names their tags stand for, as of now. Takes
 * several pages at once, so their tags are looked up together.
 */
async function toEvents(relay: Relay, pages: EventRow[][]): Promise<RelayEvent[][]> {
  const events = pages.map((rows) => rows.map((row) => ({ ...JSON.parse(row.payload), cursor: String(row.seq) }) as RelayEvent));
  const content = (e: RelayEvent) => (e.type === 'message.created' || e.type === 'message.updated' ? e.data.content : undefined);
  const mentionsOf = await resolveMentions(relay, events.flat().map(content));
  return events.map((page) =>
    page.map((e) => {
      const mentions = mentionsOf(content(e));
      return mentions ? ({ ...e, data: { ...e.data, mentions } } as RelayEvent) : e;
    }),
  );
}

/**
 * A subscription's events ahead of `at`, oldest first, one more than `limit`. Read in one transaction with the log's tail
 * (eventTailStmt), so it sees nothing past it.
 */
function pageStmt(relay: Relay, sub: SubscriptionRow, at: Position, limit: number, readable: string): Stmt {
  const from = ahead(sub, at);
  const where = belongs(sub, readable);
  return relay.db
    .prepare(`SELECT e.seq, e.payload FROM events e WHERE ${from.sql} AND ${where.sql} ORDER BY e.seq LIMIT ?`)
    .bind(...from.args, ...where.args, limit + 1);
}

/**
 * A page's rows and the position after it. `last` is how far it reached, never behind the cursor: with nothing more, the
 * log's tail when it was read, so events that didn't belong to the subscription are never looked at again. A page that
 * ends among owed replies, which sit behind the cursor, leaves the cursor where it was and still owes the rest.
 */
function paged(results: EventRow[], tail: number, at: Position, limit: number): { rows: EventRow[]; last: number; owed_after: number | null; more: boolean } {
  const rows = results.slice(0, limit);
  const more = results.length > limit;
  const reached = more ? rows[rows.length - 1]!.seq : tail;
  return { rows, last: Math.max(reached, at.cursor), owed_after: more && reached < at.cursor ? reached : null, more };
}

/**
 * A page of a subscription's events, oldest first, for an agent that may read `readable` (readableChannels): after
 * `after`, or with null, what its next digest would carry, owed replies included. `last` is how far the page reached (paged),
 * or for a page that ends among owed replies, its last one: read with `after`, that leads on to the rest of them.
 */
export async function readFeed(
  relay: Relay,
  sub: SubscriptionRow,
  after: number | null,
  limit: number,
  readable: string,
): Promise<{ events: RelayEvent[]; last: number; more: boolean }> {
  const at = after === null ? sub : { cursor: after, owed_after: null };
  const [[tail], results] = await readAll<[{ n: number }, EventRow]>(relay.db, eventTailStmt(relay), pageStmt(relay, sub, at, limit, readable));
  const { rows, last, owed_after, more } = paged(results, tail!.n, at, limit);
  return { events: (await toEvents(relay, [rows]))[0]!, last: owed_after ?? last, more };
}

/** How many events wait for the subscription's next digests, counted up to DIGEST_MAX: one `{ n }` row. */
export function countWaitingStmt(relay: Relay, sub: SubscriptionRow, readable: string): Stmt {
  const from = ahead(sub, sub);
  const where = belongs(sub, readable);
  return relay.db
    .prepare(`SELECT COUNT(*) AS n FROM (SELECT 1 FROM events e WHERE ${from.sql} AND ${where.sql} LIMIT ?)`)
    .bind(...from.args, ...where.args, DIGEST_MAX);
}

/**
 * A statement committed in one transaction with a digest's cursor move, ahead of it (a webhook delivery's row). It must
 * check the subscription is still `unmoved`, so it takes effect exactly when the move does.
 */
export type Handoff = (digest: Digest, unmoved: { sql: string; args: unknown[] }) => Stmt;

/**
 * Moves a subscription past a page it took (`digest`, null for an empty page) to `to`, as one or two statements: a
 * compare-and-set on its position (unmoved), so another taker or an unsubscribe that got there first wins; with a digest,
 * `handoff`'s statement goes ahead of it. Clearing `next_due_ms` checks the log again in the same statement, so an event
 * recorded since the page was read keeps the subscription due.
 */
function moveStmts(relay: Relay, sub: SubscriptionRow, readable: string, to: Position, digest: Digest | null, handoff?: Handoff): Stmt[] {
  const now = relay.now();
  const nowMs = now.getTime();
  const guard = unmoved(sub);
  const from = ahead(sub, to);
  const rest = belongs(sub, readable);
  const pending = `EXISTS (SELECT 1 FROM events e WHERE ${from.sql} AND ${rest.sql})`;
  if (!digest)
    return [
      sub.ended_at
        ? relay.db.prepare(`DELETE FROM subscriptions WHERE ${guard.sql}`).bind(...guard.args)
        : relay.db
            .prepare(
              `UPDATE subscriptions SET cursor = ?, owed_after = ?, next_due_ms = CASE WHEN ${pending} THEN next_due_ms ELSE NULL END WHERE ${guard.sql}`,
            )
            .bind(to.cursor, to.owed_after, ...from.args, ...rest.args, ...guard.args),
    ];
  const move = relay.db
    .prepare(
      `UPDATE subscriptions SET cursor = ?, owed_after = ?, last_delivered_ms = ?, updated_at = ?,
         next_due_ms = CASE WHEN ${pending} THEN MAX(?, ? + frequency_seconds * 1000) ELSE NULL END
       WHERE ${guard.sql}`,
    )
    .bind(to.cursor, to.owed_after, nowMs, iso(now), ...from.args, ...rest.args, nowMs, nowMs, ...guard.args);
  return handoff ? [handoff(digest, guard), move] : [move];
}

/**
 * Takes the next digest off each subscription and moves its cursor past it: the pages are read in one round trip, and the
 * moves made in another. A subscription with nothing waiting, or that another taker got to first, gives no digest.
 */
async function take(relay: Relay, subs: SubscriptionRow[], readable: string, handoff?: Handoff): Promise<Digest[]> {
  const [[tail], ...results] = await readAll<[{ n: number }, ...EventRow[]]>(
    relay.db,
    eventTailStmt(relay),
    ...subs.map((sub) => pageStmt(relay, sub, sub, DIGEST_MAX, readable)),
  );
  const pages = subs.map((sub, i) => ({ sub, ...paged(results[i]!, tail!.n, sub, DIGEST_MAX) }));
  const events = await toEvents(
    relay,
    pages.map((p) => p.rows),
  );
  const stmts: Stmt[] = [];
  const moves: { at: number; digest: Digest }[] = [];
  pages.forEach(({ sub, rows, last, owed_after, more }, i) => {
    const digest: Digest | null = rows.length
      ? { type: 'digest', subscription_id: sub.id as Digest['subscription_id'], events: events[i]!, cursor: String(last), more }
      : null;
    stmts.push(...moveStmts(relay, sub, readable, { cursor: last, owed_after }, digest, handoff));
    if (digest) moves.push({ at: stmts.length - 1, digest });
  });
  const moved = await relay.db.batch(stmts);
  return moves.filter(({ at }) => moved[at]!.meta.changes > 0).map(({ digest }) => digest);
}

/**
 * A stored digest as it may be sent now: its events read again from the log, so whatever happened since it was taken (a
 * removal, the agent leaving a conversation or losing a channel) applies to it too. `sub` is its subscription and
 * `readable` what its agent may read now (readableChannels); a subscription or agent that is gone (null) still owes its
 * removals. Null when nothing in it may go.
 */
export async function refreshDigest(relay: Relay, body: string, sub: SubscriptionRow | null, readable: string | null): Promise<string | null> {
  const digest = JSON.parse(body) as Digest;
  const where = sub && readable !== null ? belongs(sub, readable) : { sql: REMOVALS, args: [] };
  const { results } = await relay.db
    .prepare(`SELECT e.seq, e.payload FROM events e WHERE e.seq IN (SELECT value FROM json_each(?)) AND ${where.sql} ORDER BY e.seq`)
    .bind(JSON.stringify(digest.events.map((e) => Number(e.cursor))), ...where.args)
    .all<EventRow>();
  return results.length ? JSON.stringify({ ...digest, events: (await toEvents(relay, [results]))[0]! } satisfies Digest) : null;
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
  const {
    accessOf,
    rows: [subs, channels],
  } = await accessWith<[SubscriptionRow, ChannelRow]>(
    relay,
    relay.db
      .prepare(`SELECT * FROM subscriptions WHERE agent_id = ? ${mode === 'due' ? 'AND next_due_ms <= ?' : ''} ORDER BY kind DESC, created_at`)
      .bind(agent.id, ...(mode === 'due' ? [now.getTime()] : [])),
    listChannelsStmt(relay),
  );
  if (!subs.length) return { digests: [], capped: false };
  const digests = await take(relay, subs, readableIn(channels, accessOf(agent)), handoff);
  const count = digests.reduce((n, d) => n + d.events.length, 0);
  if (count) await hit(relay, deliveredToday(agent.id), count);
  return { digests, capped: false };
}
