import { readAll, type Relay } from '../context';
import { rateLimited } from '../errors';

// Fixed-window counters in D1. Exact (one writer), unlike the Workers rate-limit binding, which is
// per location and only offers 10 and 60 second windows. Keys are namespaced strings, for example
// `post:agt_…:m`, `signup:net:<hmac>:h`. Never put raw IPs or secrets in a key.

export interface Limit {
  key: string;
  limit: number;
  windowSeconds: number;
}

export interface LimitResult {
  ok: boolean;
  count: number;
  limit: number;
  retryAfterSeconds: number;
}

const windowStart = (now: Date, seconds: number) => Math.floor(now.getTime() / 1000 / seconds) * seconds;

/**
 * Counts one use (or `cost`) against the limit and says whether it is still within it. With `capped`, a window that is
 * already full is left untouched (no write), so a flood of refused requests costs reads, not rows or writes.
 */
export async function hit(relay: Relay, l: Limit, cost = 1, capped = false): Promise<LimitResult> {
  return (await hitAll(relay, [l], cost, capped))[0]!;
}

/** `hit` for every limit at once, in one round trip; each answers in the order given. */
export async function hitAll(relay: Relay, limits: Limit[], cost = 1, capped = false): Promise<LimitResult[]> {
  if (!limits.length) return [];
  const now = relay.now();
  const sql = `INSERT INTO rate_counters (key, window_start, count) VALUES (?, ?, ?) ON CONFLICT (key, window_start) DO UPDATE SET count = count + excluded.count${
    capped ? ' WHERE count < ?' : ''
  } RETURNING count`;
  const rows = await readAll<Counted[]>(
    relay.db,
    ...limits.map((l) => relay.db.prepare(sql).bind(l.key, windowStart(now, l.windowSeconds), cost, ...(capped ? [l.limit] : []))),
  );
  return limits.map((l, i) => {
    const count = rows[i]![0]?.count ?? l.limit + cost;
    return { ok: count <= l.limit, count, limit: l.limit, retryAfterSeconds: retryAfter(now, l) };
  });
}

/** The current count without adding to it. */
export async function peek(relay: Relay, l: Limit): Promise<number> {
  return (await peekAll(relay, [l]))[0]!;
}

/** `peek` for every limit at once, in one round trip. */
export async function peekAll(relay: Relay, limits: Limit[]): Promise<number[]> {
  if (!limits.length) return [];
  const now = relay.now();
  const rows = await readAll<Counted[]>(
    relay.db,
    ...limits.map((l) => relay.db.prepare('SELECT count FROM rate_counters WHERE key = ? AND window_start = ?').bind(l.key, windowStart(now, l.windowSeconds))),
  );
  return rows.map((r) => r[0]?.count ?? 0);
}

type Counted = { count: number };

/**
 * Counts `cost` (one by default) against every limit and throws 429 for the first one exceeded. A refused request counts
 * against none of them: every limit is looked at first (one round trip), then all are counted (another).
 */
export async function enforce(relay: Relay, limits: Limit[], message: string, cost = 1): Promise<void> {
  if (limits.length > 1) {
    const counts = await peekAll(relay, limits);
    const i = limits.findIndex((l, i) => counts[i]! + cost > l.limit);
    if (i >= 0) throw rateLimited(message, retryAfter(relay.now(), limits[i]!));
  }
  const over = (await hitAll(relay, limits, cost, true)).find((r) => !r.ok);
  if (over) throw rateLimited(message, over.retryAfterSeconds);
}

const retryAfter = (now: Date, l: Limit) => Math.max(1, windowStart(now, l.windowSeconds) + l.windowSeconds - Math.floor(now.getTime() / 1000));

const SWEEP_BATCH = 1000;

/** Cron: drop windows older than two days, a bounded batch at a time until it runs out of time. */
export async function sweepCountersJob(relay: Relay, ctx: { deadline?: number } = {}): Promise<number> {
  const cutoff = Math.floor(relay.now().getTime() / 1000) - 2 * 86_400;
  let total = 0;
  for (;;) {
    const r = await relay.db
      .prepare('DELETE FROM rate_counters WHERE rowid IN (SELECT rowid FROM rate_counters WHERE window_start < ? LIMIT ?)')
      .bind(cutoff, SWEEP_BATCH)
      .run();
    total += r.meta.changes;
    if (r.meta.changes < SWEEP_BATCH || (ctx.deadline !== undefined && Date.now() >= ctx.deadline)) return total;
  }
}
