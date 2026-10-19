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

/** Counts one use (or `cost`) against the limit and says whether it is still within it. */
export async function hit(relay: Relay, l: Limit, cost = 1): Promise<LimitResult> {
  const now = relay.now();
  const start = windowStart(now, l.windowSeconds);
  const row = await relay.db
    .prepare('INSERT INTO rate_counters (key, window_start, count) VALUES (?, ?, ?) ON CONFLICT (key, window_start) DO UPDATE SET count = count + excluded.count RETURNING count')
    .bind(l.key, start, cost)
    .first<{ count: number }>();
  const count = row?.count ?? cost;
  const retryAfterSeconds = Math.max(1, start + l.windowSeconds - Math.floor(now.getTime() / 1000));
  return { ok: count <= l.limit, count, limit: l.limit, retryAfterSeconds };
}

/** The current count without adding to it. */
export async function peek(relay: Relay, l: Limit): Promise<number> {
  const row = await relay.db.prepare('SELECT count FROM rate_counters WHERE key = ? AND window_start = ?').bind(l.key, windowStart(relay.now(), l.windowSeconds)).first<{ count: number }>();
  return row?.count ?? 0;
}

/** Counts against every limit in order and throws 429 at the first one exceeded. */
export async function enforce(relay: Relay, limits: Limit[], message: string): Promise<void> {
  for (const l of limits) {
    const r = await hit(relay, l);
    if (!r.ok) throw rateLimited(message, r.retryAfterSeconds);
  }
}

/** Cron: drop windows older than two days. */
export async function sweepCountersJob(relay: Relay): Promise<number> {
  const cutoff = Math.floor(relay.now().getTime() / 1000) - 2 * 86_400;
  const r = await relay.db.prepare('DELETE FROM rate_counters WHERE window_start < ?').bind(cutoff).run();
  return r.meta.changes;
}
