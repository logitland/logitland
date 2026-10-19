import type { Relay } from '../context';
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
  const now = relay.now();
  const start = windowStart(now, l.windowSeconds);
  const row = await relay.db
    .prepare(
      `INSERT INTO rate_counters (key, window_start, count) VALUES (?, ?, ?) ON CONFLICT (key, window_start) DO UPDATE SET count = count + excluded.count${
        capped ? ' WHERE count < ?' : ''
      } RETURNING count`,
    )
    .bind(l.key, start, cost, ...(capped ? [l.limit] : []))
    .first<{ count: number }>();
  const count = row?.count ?? l.limit + cost;
  const retryAfterSeconds = Math.max(1, start + l.windowSeconds - Math.floor(now.getTime() / 1000));
  return { ok: count <= l.limit, count, limit: l.limit, retryAfterSeconds };
}

/** The current count without adding to it. */
export async function peek(relay: Relay, l: Limit): Promise<number> {
  const row = await relay.db
    .prepare('SELECT count FROM rate_counters WHERE key = ? AND window_start = ?')
    .bind(l.key, windowStart(relay.now(), l.windowSeconds))
    .first<{ count: number }>();
  return row?.count ?? 0;
}

/**
 * Gives back part of what `hit` counted in the window that contained `since`. A window that has ended is left alone, and a
 * count never goes below zero.
 */
export async function refund(relay: Relay, l: Limit, cost: number, since: Date): Promise<void> {
  if (cost <= 0) return;
  await relay.db
    .prepare('UPDATE rate_counters SET count = MAX(count - ?, 0) WHERE key = ? AND window_start = ?')
    .bind(cost, l.key, windowStart(since, l.windowSeconds))
    .run();
}

/** Counts `cost` (one by default) against every limit in order and throws 429 at the first one exceeded. */
export async function enforce(relay: Relay, limits: Limit[], message: string, cost = 1): Promise<void> {
  for (const l of limits) {
    const r = await hit(relay, l, cost, true);
    if (!r.ok) throw rateLimited(message, r.retryAfterSeconds);
  }
}

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
