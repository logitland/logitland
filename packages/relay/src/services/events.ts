import { newId, type EventType, type RelayEvent } from '@logitland/contracts';
import { iso, type Relay, type Stmt } from '../context';
import { enqueuer, fanOut, newFanOutBudget, type EventRow, type FanOutBudget } from './deliveries';

// The event log: recording events (shared by intake and scrub) and reading them back for GET /v1/events.
// Payloads are stored without `cursor`; whoever serves or delivers an event adds `cursor: String(seq)`.

/** Event text older than this is blanked (retention.ts), so a cursor that far back can't be served. */
export const EVENT_TEXT_DAYS = 30;

/** D1 allows 100 bound parameters per query. */
export const MAX_PARAMS = 90;

export function chunk<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

export const placeholders = (n: number) => Array.from({ length: n }, () => '?').join(', ');

/** Orders snowflakes (which exceed 2^53) numerically. */
export const compareSnowflakes = (a: string, b: string) => (BigInt(a) < BigInt(b) ? -1 : BigInt(a) > BigInt(b) ? 1 : 0);

/** When Discord made a snowflake: its first 42 bits are milliseconds since 2015-01-01. */
export const snowflakeTime = (id: string) => new Date(Number(BigInt(id) >> 22n) + 1_420_070_400_000).toISOString();

export interface PlannedEvent {
  row: EventRow;
  stmt: Stmt;
  /** False records the event without telling subscribers (for example an edit to a message the relay never saw). */
  fan: boolean;
}

/** An INSERT OR IGNORE keyed on source_key: replaying the same source event records nothing new. */
export function planEvent(
  relay: Relay,
  e: {
    type: EventType;
    guildId: string;
    channelId: string;
    messageId: string | null;
    sourceKey: string;
    data: Record<string, unknown>;
    fan?: boolean;
    /** Record nothing if an event with this source key exists when the statement runs (a create racing its own delete). */
    unless?: string;
  },
): PlannedEvent {
  const id = newId('event');
  const at = iso(relay.now());
  const payload = JSON.stringify({
    id,
    schema_version: 1,
    type: e.type,
    observed_at: at,
    guild_id: e.guildId,
    channel_id: e.channelId,
    data: e.data,
  });
  const fan = e.fan ?? true;
  // An event nobody needs telling about is born fanned out, so the refan job leaves it alone.
  const values = [id, e.sourceKey, e.type, e.guildId, e.channelId, e.messageId, payload, at, fan ? null : at];
  const stmt =
    e.unless === undefined
      ? relay.db
          .prepare(
            'INSERT OR IGNORE INTO events (id, source_key, type, guild_id, channel_id, message_id, payload, observed_at, fanned_out_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
          )
          .bind(...values)
      : relay.db
          .prepare(
            'INSERT OR IGNORE INTO events (id, source_key, type, guild_id, channel_id, message_id, payload, observed_at, fanned_out_at) SELECT ?, ?, ?, ?, ?, ?, ?, ?, ? WHERE NOT EXISTS (SELECT 1 FROM events WHERE source_key = ?)',
          )
          .bind(...values, e.unless);
  return { row: { id, type: e.type, guild_id: e.guildId, channel_id: e.channelId, payload }, stmt, fan };
}

/**
 * Fans one event out. Null when it failed or the budget ran out: the event is still in the log for pollers,
 * and the refan job tries again.
 */
export async function fanOutSafe(
  relay: Relay,
  row: EventRow,
  budget: FanOutBudget = newFanOutBudget(),
  sink?: (ids: string[]) => Promise<void>,
): Promise<number | null> {
  try {
    const created = await fanOut(relay, row, { budget, ...(sink ? { sink } : {}) });
    return budget.stopped ? null : created.length;
  } catch (error) {
    relay.log.error('intake.fan_out_failed', { event_id: row.id, type: row.type, error });
    return null;
  }
}

/** The channels (among the events') that any subscription listens to. Null if the lookup failed, which means "can't rule any out". */
async function watchedChannels(relay: Relay, rows: EventRow[], budget: FanOutBudget): Promise<Set<string> | null> {
  const watched = new Set<string>();
  try {
    for (const part of chunk([...new Set(rows.map((r) => r.channel_id))], MAX_PARAMS)) {
      budget.queries--;
      const { results } = await relay.db
        .prepare(`SELECT DISTINCT channel_id FROM subscription_channels WHERE channel_id IN (${placeholders(part.length)})`)
        .bind(...part)
        .all<{ channel_id: string }>();
      for (const r of results) watched.add(r.channel_id);
    }
  } catch (error) {
    relay.log.error('intake.fan_out_lookup_failed', { error });
    return null;
  }
  return watched;
}

/**
 * Fans each event out and notes the ones that worked. Returns how many deliveries were made. One query tells which
 * of the events' channels have any subscriber, so the rest cost nothing; the budget bounds the queries the rest may
 * spend, and an event it can't cover is left for the refan job.
 */
export async function fanOutAll(relay: Relay, rows: EventRow[], budget: FanOutBudget = newFanOutBudget()): Promise<number> {
  let deliveries = 0;
  const done: string[] = [];
  const watched = await watchedChannels(relay, rows, budget);
  const out = enqueuer(relay, budget);
  for (const row of rows) {
    if (watched && !watched.has(row.channel_id)) {
      done.push(row.id);
      continue;
    }
    const n = await fanOutSafe(relay, row, budget, async (ids) => {
      deliveries += ids.length;
      await out.add(ids);
    });
    if (n !== null) done.push(row.id);
  }
  try {
    await out.flush();
  } catch (error) {
    // The deliveries exist with no enqueued_at, which is what the cron scan looks for.
    relay.log.error('intake.enqueue_failed', { error });
  }
  const at = iso(relay.now());
  for (const part of chunk(done, MAX_PARAMS)) {
    try {
      await relay.db
        .prepare(`UPDATE events SET fanned_out_at = ? WHERE fanned_out_at IS NULL AND id IN (${placeholders(part.length)})`)
        .bind(at, ...part)
        .run();
    } catch (error) {
      // Not marking only means a second, harmless fan-out later: deliveries are unique per subscription and event.
      relay.log.error('intake.fan_out_unmarked', { count: part.length, error });
    }
  }
  return deliveries;
}

const REFAN_AFTER_MS = 60_000;
const REFAN_BATCH = 50;

/** Cron: events whose fan-out failed (or never finished) are fanned out again. Returns how many it tried. */
export async function refanJob(relay: Relay, ctx: { deadline?: number } = {}): Promise<number> {
  const cutoff = iso(new Date(relay.now().getTime() - REFAN_AFTER_MS));
  const { results } = await relay.db
    .prepare('SELECT id, type, guild_id, channel_id, payload FROM events WHERE fanned_out_at IS NULL AND observed_at < ? ORDER BY observed_at LIMIT ?')
    .bind(cutoff, REFAN_BATCH)
    .all<EventRow>();
  if (!results.length) return 0;
  const deliveries = await fanOutAll(relay, results, newFanOutBudget(ctx.deadline));
  relay.log.info('intake.refanned', { events: results.length, deliveries });
  return results.length;
}

/** Runs the statements as one transaction, then fans out each event whose row was new. `at` is the index of the event's INSERT among the statements. */
export async function commitPlan(
  relay: Relay,
  stmts: Stmt[],
  events: { at: number; event: PlannedEvent }[],
): Promise<{ recorded: number; deliveries: number }> {
  if (!stmts.length) return { recorded: 0, deliveries: 0 };
  const results = await relay.db.batch(stmts);
  let recorded = 0;
  const fan: EventRow[] = [];
  for (const { at, event } of events) {
    if (results[at]!.meta.changes !== 1) continue;
    recorded++;
    if (event.fan) fan.push(event.row);
  }
  return { recorded, deliveries: await fanOutAll(relay, fan) };
}

export async function eventTail(relay: Relay): Promise<number> {
  return (await relay.db.prepare('SELECT COALESCE(MAX(seq), 0) AS n FROM events').first<{ n: number }>())?.n ?? 0;
}

export interface EventsQuery {
  after: number;
  channelId?: string;
  limit: number;
}

/** Events after a cursor in channels open to agents, oldest first. Seq numbers fit a JavaScript number. */
export async function listEvents(relay: Relay, q: EventsQuery): Promise<{ events: RelayEvent[]; next_cursor: string }> {
  // Read the tail first: anything committed before this read is visible to the query below.
  const tail = await eventTail(relay);
  const where = ['e.seq > ?', "e.channel_id IN (SELECT id FROM channels WHERE agent_access != 'off')"];
  const args: unknown[] = [q.after];
  if (q.channelId) {
    where.push('e.channel_id = ?');
    args.push(q.channelId);
  }
  const { results } = await relay.db
    .prepare(`SELECT e.seq, e.payload FROM events e WHERE ${where.join(' AND ')} ORDER BY e.seq LIMIT ?`)
    .bind(...args, q.limit)
    .all<{ seq: number; payload: string }>();
  const events = results.map((r) => ({ ...JSON.parse(r.payload), cursor: String(r.seq) }) as RelayEvent);
  const last = results.length ? results[results.length - 1]!.seq : 0;
  // A short page means everything up to the tail was scanned, including events in channels this agent can't see.
  const next = results.length === q.limit ? last : Math.max(tail, q.after, last);
  return { events, next_cursor: String(next) };
}

/**
 * Event text is kept for EVENT_TEXT_DAYS. If the first event after the cursor is older than that, its text is
 * gone and the agent should catch up by reading channels. Returns the cursor to resume from, or null if fine.
 */
export async function expiredCursor(relay: Relay, after: number): Promise<string | null> {
  const cutoff = iso(new Date(relay.now().getTime() - EVENT_TEXT_DAYS * 86_400_000));
  const first = await relay.db.prepare('SELECT observed_at FROM events WHERE seq > ? ORDER BY seq LIMIT 1').bind(after).first<{ observed_at: string }>();
  if (!first || first.observed_at >= cutoff) return null;
  const oldest = await relay.db.prepare('SELECT MIN(seq) AS n FROM events WHERE observed_at >= ?').bind(cutoff).first<{ n: number | null }>();
  return String(oldest?.n ? oldest.n - 1 : await eventTail(relay));
}
