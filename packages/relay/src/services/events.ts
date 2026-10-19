import { newId, type EventType, type RelayEvent } from '@logitland/contracts';
import { iso, type Relay, type Stmt } from '../context';
import { fanOut, type EventRow } from './deliveries';

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

export interface PlannedEvent {
  row: EventRow;
  stmt: Stmt;
  /** False records the event without telling subscribers (for example an edit to a message the relay never saw). */
  fan: boolean;
}

/** An INSERT OR IGNORE keyed on source_key: replaying the same source event records nothing new. */
export function planEvent(
  relay: Relay,
  e: { type: EventType; guildId: string; channelId: string; messageId: string | null; sourceKey: string; data: Record<string, unknown>; fan?: boolean },
): PlannedEvent {
  const id = newId('event');
  const payload = JSON.stringify({ id, schema_version: 1, type: e.type, observed_at: iso(relay.now()), guild_id: e.guildId, channel_id: e.channelId, data: e.data });
  const stmt = relay.db
    .prepare('INSERT OR IGNORE INTO events (id, source_key, type, guild_id, channel_id, message_id, payload, observed_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .bind(id, e.sourceKey, e.type, e.guildId, e.channelId, e.messageId, payload, iso(relay.now()));
  return { row: { id, type: e.type, guild_id: e.guildId, channel_id: e.channelId, payload }, stmt, fan: e.fan ?? true };
}

/**
 * Runs the statements as one transaction, then fans out each event whose row was new. `at` is the index of
 * the event's INSERT among the statements. A fan-out that fails is logged and doesn't undo the record: the
 * event is still in the log for pollers.
 */
export async function commitPlan(relay: Relay, stmts: Stmt[], events: { at: number; event: PlannedEvent }[]): Promise<{ recorded: number; deliveries: number }> {
  if (!stmts.length) return { recorded: 0, deliveries: 0 };
  const results = await relay.db.batch(stmts);
  let recorded = 0;
  let deliveries = 0;
  for (const { at, event } of events) {
    if (results[at]!.meta.changes !== 1) continue;
    recorded++;
    if (!event.fan) continue;
    try {
      deliveries += (await fanOut(relay, event.row)).length;
    } catch (error) {
      relay.log.error('intake.fan_out_failed', { event_id: event.row.id, type: event.row.type, error });
    }
  }
  return { recorded, deliveries };
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
