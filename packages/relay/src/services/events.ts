import { newId, type EventType } from '@logitland/contracts';
import { iso, type Relay, type Stmt } from '../context';
import { wake } from './deliveries';

// The event log: recording events (shared by intake, scrub and the status trigger). Subscriptions read it from their own
// cursor (feed.ts); there is no per-event fan-out. Payloads are stored without `cursor`; whoever serves an event adds
// `cursor: String(seq)`.

/** Event text older than this is blanked (retention.ts), so a cursor that far back can't be served in full. */
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

/** SQL over two parameters (a thread ID, a message ID): the private conversation they are in, or NULL. */
const PRIVATE_THREAD_SQL = `(SELECT t.id FROM threads t WHERE t.private = 1 AND t.id = CAST(COALESCE(?, (SELECT c.thread_id FROM conversation c WHERE c.message_id = ?)) AS INTEGER))`;

export interface PlannedEvent {
  id: string;
  stmt: Stmt;
}

/**
 * An INSERT OR IGNORE keyed on source_key: replaying the same source event records nothing new. Recording it makes the
 * subscriptions it concerns due (the events_due trigger); `wake` then tells the transports.
 */
export function planEvent(
  relay: Relay,
  e: {
    type: EventType;
    guildId: string;
    channelId: string;
    messageId: string | null;
    sourceKey: string;
    data: Record<string, unknown>;
    /** True records the event without announcing it (a channel's history on first look). */
    silent?: boolean;
    /** The agent that wrote the message, and the agent whose message it replies to (feed.ts). */
    authorAgentId?: string | null;
    replyAgentId?: string | null;
    /** For this agent alone (conversation.invited): it rides the agent's replies subscription. */
    agentId?: string | null;
    /** Record nothing if an event with this source key exists when the statement runs (a create racing its own delete). */
    unless?: string;
    /** Record nothing unless this SQL condition holds when the statement runs (a person's words after they withdrew). */
    when?: { sql: string; args: unknown[] };
  },
): PlannedEvent {
  const id = newId('event');
  const at = iso(relay.now());
  const payload = JSON.stringify({ id, schema_version: 1, type: e.type, observed_at: at, guild_id: e.guildId, channel_id: e.channelId, data: e.data });
  // An event inside a private conversation is marked with it, so only its members get it (feed.ts). The thread is the event's
  // own, or the thread of the message it is about (an edit or a removal names only the message).
  const thread = typeof e.data.thread_id === 'string' ? e.data.thread_id : null;
  const message = e.messageId ?? (Array.isArray(e.data.message_ids) ? (e.data.message_ids[0] as string) : null);
  const values = [
    id,
    e.sourceKey,
    e.type,
    e.guildId,
    e.channelId,
    e.messageId,
    payload,
    at,
    e.authorAgentId ?? null,
    e.replyAgentId ?? null,
    e.agentId ?? null,
    e.silent ? 1 : 0,
    thread,
    message,
  ];
  const columns =
    'id, source_key, type, guild_id, channel_id, message_id, payload, observed_at, author_agent_id, reply_agent_id, agent_id, silent, private_thread_id';
  const row = `?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ${PRIVATE_THREAD_SQL}`;
  const stmt =
    e.unless === undefined && e.when === undefined
      ? relay.db.prepare(`INSERT OR IGNORE INTO events (${columns}) VALUES (${row})`).bind(...values)
      : relay.db
          .prepare(
            `INSERT OR IGNORE INTO events (${columns}) SELECT ${row} WHERE ${
              e.unless === undefined ? '1' : 'NOT EXISTS (SELECT 1 FROM events WHERE source_key = ?)'
            }${e.when ? ` AND (${e.when.sql})` : ''}`,
          )
          .bind(...values, ...(e.unless === undefined ? [] : [e.unless]), ...(e.when?.args ?? []));
  return { id, stmt };
}

/** Runs the statements as one transaction, then wakes whoever has something due. `at` is the index of the event's INSERT. */
export async function commitPlan(relay: Relay, stmts: Stmt[], events: { at: number; event: PlannedEvent }[]): Promise<{ recorded: number }> {
  if (!stmts.length) return { recorded: 0 };
  const results = await relay.db.batch(stmts);
  const recorded = events.filter(({ at }) => results[at]!.meta.changes > 0).length;
  // The events are committed; a failed wake is caught up by the minute's cron, so it mustn't fail the caller.
  if (recorded) await wake(relay).catch((error: unknown) => relay.log.error('events.wake_failed', { error }));
  return { recorded };
}

export async function eventTail(relay: Relay): Promise<number> {
  return (await relay.db.prepare('SELECT COALESCE(MAX(seq), 0) AS n FROM events').first<{ n: number }>())?.n ?? 0;
}
