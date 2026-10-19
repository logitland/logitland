import { LIMITS, newId, type DeliveryDetail, type DeliveryStatus, type EventType } from '@logitland/contracts';
import { signHeaders } from '@logitland/webhooks';
import { iso, type Relay } from '../context';
import { audit, auditStmt } from './audit';
import { getChannel } from './channels';
import { DestinationRefused, preflightDestination } from './destinations';
import { dropPendingStmt, previousSecretAad, secretAad, urlAad, type SubscriptionRow } from './subscriptions';

// The delivery ledger (D1) is the source of truth, whichever way deliveries are dispatched. With a Queue
// bound, new deliveries are enqueued and the consumer retries them; without one, the cron scan attempts
// the due rows itself. Either way every attempt goes through `attemptDelivery`, which claims the row with
// a compare-and-set first, so a delivery is never sent by two workers at once. Receivers must still dedupe
// on webhook-id: an attempt that times out may have reached them.

export interface EventRow {
  id: string;
  type: string;
  guild_id: string;
  channel_id: string;
  payload: string;
}

export type AttemptResult = { outcome: 'delivered' } | { outcome: 'retry'; afterSeconds: number } | { outcome: 'failed' | 'dropped' | 'skipped'; reason: string };

/** How long a claimed attempt may run before another worker may take the row. */
const LEASE_MS = 5 * 60_000;
/** The cron scan re-enqueues a due row only if it was last enqueued longer ago than this. */
const REENQUEUE_AFTER_MS = 10 * 60_000;
const DRAIN_ROWS = 100;
const INSERT_BATCH = 50;
/** Queues: sendBatch takes 100 messages; a retry delay can be 24 hours at most (developers.cloudflare.com/queues/platform/limits). */
const QUEUE_BATCH = 100;
const QUEUE_MAX_DELAY_SECONDS = 86_400;
const RETRY_AFTER_MAX_SECONDS = 86_400;
const FAILED_MESSAGE_RETRY_SECONDS = 60;
const REPLAY_EXTRA_ATTEMPTS = 3;
const GENERIC_ERROR = 'Internal error while delivering';

/** Exponential backoff with jitter: 30 s, 1 min, 2 min … capped at 6 h, each between half and all of that. */
export function backoffSeconds(attempt: number, random: () => number = Math.random): number {
  const ceiling = Math.min(30 * 2 ** Math.max(0, attempt - 1), 6 * 3600);
  return Math.max(5, Math.round(ceiling * (0.5 + random() / 2)));
}

const chunk = <T>(items: T[], size: number): T[][] => Array.from({ length: Math.ceil(items.length / size) }, (_, i) => items.slice(i * size, (i + 1) * size));

/* ---------- Fan-out and enqueue ---------- */

/**
 * Create one delivery per matching, active subscription and put them on the Queue. A subscription matches
 * through subscription_channels (the event's channel) and its event types, except that `subscription.gap`
 * goes to every active subscription of the channel. Returns the new delivery IDs; a repeated call for the
 * same event creates (and enqueues) nothing.
 */
export async function fanOut(relay: Relay, event: EventRow): Promise<string[]> {
  const { results } = await relay.db
    .prepare(
      `SELECT s.id, s.events FROM subscription_channels sc
       JOIN subscriptions s ON s.id = sc.subscription_id
       JOIN agents a ON a.id = s.agent_id
       WHERE sc.channel_id = ? AND s.status = 'active' AND a.status = 'active'`,
    )
    .bind(event.channel_id)
    .all<{ id: string; events: string }>();
  const matching = results.filter((s) => event.type === 'subscription.gap' || (JSON.parse(s.events) as string[]).includes(event.type));
  if (!matching.length) return [];

  const now = relay.now();
  const at = iso(now);
  const rows = matching.map((s) => ({ id: newId('delivery', now.getTime()), subscriptionId: s.id }));
  const created: string[] = [];
  for (const part of chunk(rows, INSERT_BATCH)) {
    const inserted = await relay.db.batch(
      part.map((r) =>
        relay.db
          .prepare("INSERT OR IGNORE INTO deliveries (id, subscription_id, event_id, event_type, status, attempts, next_attempt_at, created_at) VALUES (?, ?, ?, ?, 'pending', 0, ?, ?)")
          .bind(r.id, r.subscriptionId, event.id, event.type, at, at),
      ),
    );
    part.forEach((r, i) => {
      if (inserted[i]!.meta.changes === 1) created.push(r.id);
    });
  }
  await enqueue(relay, created);
  return created;
}

async function markEnqueued(relay: Relay, ids: string[], at: Date): Promise<void> {
  await relay.db.prepare('UPDATE deliveries SET enqueued_at = ? WHERE id IN (SELECT value FROM json_each(?))').bind(iso(at), JSON.stringify(ids)).run();
}

/**
 * Put deliveries on the Queue (100 per sendBatch, or one send each) and stamp enqueued_at. A failure is
 * logged and leaves enqueued_at empty, which is exactly what the cron scan looks for.
 */
async function enqueue(relay: Relay, ids: string[]): Promise<void> {
  const queue = relay.queue;
  if (!queue) return;
  for (const part of chunk(ids, QUEUE_BATCH)) {
    try {
      if (queue.sendBatch) await queue.sendBatch(part.map((id) => ({ body: { delivery_id: id } })));
      else for (const id of part) await queue.send({ delivery_id: id });
    } catch (error) {
      relay.log.error('deliveries.enqueue_failed', { count: part.length, error });
      continue;
    }
    await markEnqueued(relay, part, relay.now());
  }
}

/* ---------- Attempts ---------- */

interface Claim {
  subscription_id: string;
  event_id: string;
  attempts: number;
  attempt_limit: number | null;
}

interface Attempt {
  deliveryId: string;
  subscriptionId: string;
  /** This attempt's number (1-based). */
  n: number;
  /** Attempts allowed in all; an admin replay of an exhausted delivery raises it. */
  limit: number;
  startedAt: Date;
}

type Settlement =
  | { status: 'delivered'; code: number }
  | { status: 'retrying'; code: number | null; error: string; afterSeconds: number }
  | { status: 'failed'; code: number | null; error: string; disable?: string }
  | { status: 'dropped'; error: string };

function retryOrFail(a: Attempt, code: number | null, reason: string, afterSeconds?: number): Settlement {
  if (a.n >= a.limit) return { status: 'failed', code, error: `${reason}; gave up after ${a.n} attempts` };
  return { status: 'retrying', code, error: reason, afterSeconds: afterSeconds ?? backoffSeconds(a.n) };
}

/** Retry-After as seconds (or an HTTP date), capped at 24 hours. Undefined when absent or unusable. */
function retryAfterSeconds(header: string | null, now: Date): number | undefined {
  if (!header) return undefined;
  const value = header.trim();
  const seconds = /^\d+$/.test(value) ? Number(value) : (Date.parse(value) - now.getTime()) / 1000;
  return Number.isFinite(seconds) && seconds > 0 ? Math.min(Math.ceil(seconds), RETRY_AFTER_MAX_SECONDS) : undefined;
}

/**
 * Try to send one delivery. Safe to run twice at once: the claim is a compare-and-set that also leases the
 * row, so the second caller gets `skipped`. Everything after the claim is recorded as an attempt, whatever
 * happens, so a leased row never sits with nothing written.
 */
export async function attemptDelivery(relay: Relay, deliveryId: string): Promise<AttemptResult> {
  const now = relay.now();
  const claim = await relay.db
    .prepare(
      `UPDATE deliveries SET attempts = attempts + 1, next_attempt_at = ?
       WHERE id = ? AND status IN ('pending', 'retrying') AND (next_attempt_at IS NULL OR next_attempt_at <= ?)
       RETURNING subscription_id, event_id, attempts, attempt_limit`,
    )
    .bind(iso(new Date(now.getTime() + LEASE_MS)), deliveryId, iso(now))
    .first<Claim>();
  if (!claim) return { outcome: 'skipped', reason: 'Not due, or already handled' };

  const attempt: Attempt = { deliveryId, subscriptionId: claim.subscription_id, n: claim.attempts, limit: claim.attempt_limit ?? LIMITS.deliveryMaxAttempts, startedAt: now };
  try {
    return await deliver(relay, attempt, claim.event_id);
  } catch (error) {
    relay.log.error('delivery.attempt_crashed', { delivery_id: deliveryId, attempt: attempt.n, error });
    return settle(relay, attempt, retryOrFail(attempt, null, GENERIC_ERROR));
  }
}

async function deliver(relay: Relay, a: Attempt, eventId: string): Promise<AttemptResult> {
  const sub = await relay.db.prepare('SELECT * FROM subscriptions WHERE id = ?').bind(a.subscriptionId).first<SubscriptionRow>();
  const agent = sub ? await relay.db.prepare('SELECT status, scopes FROM agents WHERE id = ?').bind(sub.agent_id).first<{ status: string; scopes: string }>() : null;
  const event = await relay.db.prepare('SELECT seq, channel_id, payload FROM events WHERE id = ?').bind(eventId).first<{ seq: number; channel_id: string; payload: string }>();
  const channel = event ? await getChannel(relay, event.channel_id) : null;

  // Re-check before sending: what was true at fan-out may not be now.
  const drop = (error: string) => settle(relay, a, { status: 'dropped', error });
  if (!sub || sub.status !== 'active') return drop('The subscription is no longer active');
  if (agent?.status !== 'active') return drop('The agent is no longer active');
  if (!(JSON.parse(agent.scopes) as string[]).includes('messages:read')) return drop('The agent no longer has messages:read');
  if (!event) return drop('The event is no longer available');
  if (!channel || channel.agent_access === 'off') return drop('The channel is no longer open to agents');

  const target = await relay.secrets.open(sub.url_ciphertext, urlAad(sub.id));
  let url: URL;
  try {
    url = await preflightDestination(target, relay.resolver, relay.config.blockedHosts);
  } catch (err) {
    if (err instanceof DestinationRefused) return settle(relay, a, retryOrFail(a, null, `Refused at send time: ${err.message}`));
    throw err;
  }

  // The stored payload has no cursor; whoever serves an event adds its sequence number.
  const body = JSON.stringify({ ...(JSON.parse(event.payload) as object), cursor: String(event.seq) });
  const secrets = [await relay.secrets.open(sub.secret_ciphertext, secretAad(sub.id))];
  if (sub.secret_previous_ciphertext && sub.secret_previous_until && sub.secret_previous_until > iso(relay.now())) {
    secrets.push(await relay.secrets.open(sub.secret_previous_ciphertext, previousSecretAad(sub.id)));
  }

  let res: Response;
  try {
    res = await relay.fetch(url, {
      method: 'POST',
      redirect: 'manual',
      // A fresh header allowlist: never forward relay keys, Discord tokens, cookies or other credentials.
      headers: { 'content-type': 'application/json', 'user-agent': 'Logitland-Relay/0.1', ...(await signHeaders(secrets, a.deliveryId, body, relay.now())) },
      body,
      signal: AbortSignal.timeout(LIMITS.deliveryTimeoutMs),
    });
  } catch (err) {
    const timedOut = err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError');
    return settle(relay, a, retryOrFail(a, null, timedOut ? `No answer within ${LIMITS.deliveryTimeoutMs / 1000} s` : 'Couldn’t connect to the destination'));
  }
  await res.body?.cancel().catch(() => {});

  const code = res.status;
  if (code >= 200 && code < 300) return settle(relay, a, { status: 'delivered', code });
  if (code === 410) {
    return settle(relay, a, {
      status: 'failed',
      code,
      error: '410 Gone from the destination; the subscription was disabled',
      disable: 'The destination answered 410 Gone, so the relay stopped sending. Create a new subscription to start again.',
    });
  }
  if (code === 429 || code === 408 || code >= 500) return settle(relay, a, retryOrFail(a, code, `${code} from the destination`, retryAfterSeconds(res.headers.get('retry-after'), relay.now())));
  // Redirects are never followed, and other 4xx won't get better by waiting.
  return settle(relay, a, { status: 'failed', code, error: code >= 300 && code < 400 ? `${code} redirect not followed` : `${code} from the destination` });
}

/**
 * Record an attempt's outcome: the delivery row, the attempt row and whatever it means for the
 * subscription, in one batch. Only deliveries that end `failed` count toward the failure streak; retries
 * don't, and neither do drops.
 */
async function settle(relay: Relay, a: Attempt, s: Settlement): Promise<AttemptResult> {
  const finished = relay.now();
  const at = iso(finished);
  const code = 'code' in s ? s.code : null;
  const error = 'error' in s ? s.error : null;
  const next = s.status === 'retrying' ? iso(new Date(finished.getTime() + s.afterSeconds * 1000)) : null;
  const stmts = [
    relay.db
      .prepare('UPDATE deliveries SET status = ?, last_status_code = ?, last_error = ?, next_attempt_at = ?, delivered_at = COALESCE(?, delivered_at) WHERE id = ?')
      .bind(s.status, code, error, next, s.status === 'delivered' ? at : null, a.deliveryId),
    relay.db
      .prepare('INSERT OR IGNORE INTO delivery_attempts (delivery_id, n, started_at, status_code, error, duration_ms) VALUES (?, ?, ?, ?, ?, ?)')
      .bind(a.deliveryId, a.n, iso(a.startedAt), code, error, Math.max(0, finished.getTime() - a.startedAt.getTime())),
  ];

  if (s.status === 'delivered') {
    stmts.push(relay.db.prepare('UPDATE subscriptions SET failure_streak = 0 WHERE id = ? AND failure_streak != 0').bind(a.subscriptionId));
  } else if (s.status === 'failed' && s.disable) {
    stmts.push(
      relay.db.prepare("UPDATE subscriptions SET status = 'disabled', paused_reason = ? WHERE id = ?").bind(s.disable, a.subscriptionId),
      dropPendingStmt(relay, a.subscriptionId, 'The subscription was disabled'),
      relay.db.prepare('DELETE FROM subscription_channels WHERE subscription_id = ?').bind(a.subscriptionId),
      auditStmt(relay, { actor_type: 'system', actor_id: 'relay', action: 'subscription.disabled', target_type: 'subscription', target_id: a.subscriptionId, reason: s.disable }),
    );
    relay.log.warn('subscription.disabled', { subscription_id: a.subscriptionId, delivery_id: a.deliveryId });
  } else if (s.status === 'failed') {
    const sub = await relay.db.prepare('SELECT status, failure_streak FROM subscriptions WHERE id = ?').bind(a.subscriptionId).first<{ status: string; failure_streak: number }>();
    const pausing = sub?.status === 'active' && sub.failure_streak + 1 >= LIMITS.pauseAfterFailedDeliveries;
    const reason = `Paused after ${LIMITS.pauseAfterFailedDeliveries} failed deliveries in a row. Fix the destination, then resume it.`;
    // The CASE decides the pause (so concurrent failures can't both miss it); the extras below follow the read above.
    stmts.push(
      relay.db
        .prepare(
          `UPDATE subscriptions SET failure_streak = failure_streak + 1,
             status = CASE WHEN status = 'active' AND failure_streak + 1 >= ? THEN 'paused' ELSE status END,
             paused_reason = CASE WHEN status = 'active' AND failure_streak + 1 >= ? THEN ? ELSE paused_reason END,
             paused_at = CASE WHEN status = 'active' AND failure_streak + 1 >= ? THEN ? ELSE paused_at END
           WHERE id = ?`,
        )
        .bind(LIMITS.pauseAfterFailedDeliveries, LIMITS.pauseAfterFailedDeliveries, reason, LIMITS.pauseAfterFailedDeliveries, at, a.subscriptionId),
    );
    if (pausing) {
      stmts.push(
        dropPendingStmt(relay, a.subscriptionId, 'The subscription was paused'),
        auditStmt(relay, { actor_type: 'system', actor_id: 'relay', action: 'subscription.paused', target_type: 'subscription', target_id: a.subscriptionId, reason }),
      );
      relay.log.warn('subscription.paused', { subscription_id: a.subscriptionId, failure_streak: sub.failure_streak + 1 });
    }
  }

  await relay.db.batch(stmts);
  switch (s.status) {
    case 'delivered':
      return { outcome: 'delivered' };
    case 'retrying':
      return { outcome: 'retry', afterSeconds: s.afterSeconds };
    default:
      return { outcome: s.status, reason: s.error };
  }
}

/* ---------- Cron, Queue consumer and replay ---------- */

/**
 * Cron: recover deliveries that are due. In Queue mode, re-enqueue those never enqueued or last enqueued
 * over 10 minutes ago (the Queue normally holds retries itself). Without a Queue, attempt them here.
 * Takes up to 100 rows a run and returns how many.
 */
export async function drainDue(relay: Relay): Promise<number> {
  const now = relay.now();
  const queued = Boolean(relay.queue);
  const { results } = await relay.db
    .prepare(
      `SELECT id FROM deliveries
       WHERE status IN ('pending', 'retrying') AND next_attempt_at <= ? ${queued ? 'AND (enqueued_at IS NULL OR enqueued_at < ?)' : ''}
       ORDER BY next_attempt_at LIMIT ?`,
    )
    .bind(...(queued ? [iso(now), iso(new Date(now.getTime() - REENQUEUE_AFTER_MS)), DRAIN_ROWS] : [iso(now), DRAIN_ROWS]))
    .all<{ id: string }>();
  const ids = results.map((r) => r.id);
  if (queued) {
    await enqueue(relay, ids);
    return ids.length;
  }
  for (const id of ids) {
    try {
      await attemptDelivery(relay, id);
    } catch (error) {
      relay.log.error('deliveries.drain_failed', { delivery_id: id, error });
    }
  }
  return ids.length;
}

/**
 * Admin replay: same webhook-id, a new attempt timestamp, after the same checks as any attempt. A row
 * under an active lease (or waiting for its next retry) is refused. Replaying an exhausted delivery grants
 * three more attempts.
 */
export async function replayDelivery(relay: Relay, deliveryId: string, adminId?: string): Promise<AttemptResult> {
  const at = iso(relay.now());
  const r = await relay.db
    .prepare(
      `UPDATE deliveries SET status = 'retrying', next_attempt_at = ?, enqueued_at = NULL,
         attempt_limit = CASE WHEN attempts >= COALESCE(attempt_limit, ?) THEN attempts + ? ELSE attempt_limit END
       WHERE id = ? AND (status IN ('failed', 'dropped', 'delivered') OR (status IN ('pending', 'retrying') AND next_attempt_at <= ?))`,
    )
    .bind(at, LIMITS.deliveryMaxAttempts, REPLAY_EXTRA_ATTEMPTS, deliveryId, at)
    .run();
  if (r.meta.changes !== 1) return { outcome: 'skipped', reason: 'That delivery is being attempted or is waiting for its next retry. Replay it once it has finished.' };
  await audit(relay, { actor_type: adminId ? 'admin' : 'system', actor_id: adminId ?? 'relay', action: 'delivery.replayed', target_type: 'delivery', target_id: deliveryId });
  return attemptDelivery(relay, deliveryId);
}

/**
 * Queue consumer body. Each message is handled on its own: one that throws is retried after 60 seconds and
 * doesn't affect the others. A delivery that wants a retry is handed back to the Queue with its delay
 * (capped at the Queues maximum of 24 hours).
 */
export async function handleDeliveryBatch(
  relay: Relay,
  messages: readonly { body: unknown; ack(): void; retry(options?: { delaySeconds?: number }): void }[],
): Promise<AttemptResult[]> {
  const out: AttemptResult[] = [];
  for (const m of messages) {
    try {
      const id = (m.body as { delivery_id?: unknown } | null)?.delivery_id;
      if (typeof id !== 'string') {
        m.ack();
        continue;
      }
      const result = await attemptDelivery(relay, id);
      out.push(result);
      if (result.outcome === 'retry') {
        const delaySeconds = Math.min(result.afterSeconds, QUEUE_MAX_DELAY_SECONDS);
        // The Queue now holds this retry, so the cron scan should leave the row alone until well after it is due.
        await markEnqueued(relay, [id], new Date(relay.now().getTime() + delaySeconds * 1000));
        m.retry({ delaySeconds });
      } else {
        m.ack();
      }
    } catch (error) {
      relay.log.error('deliveries.message_failed', { error });
      out.push({ outcome: 'skipped', reason: 'Unexpected error; retrying in 60 s' });
      m.retry({ delaySeconds: FAILED_MESSAGE_RETRY_SECONDS });
    }
  }
  return out;
}

/* ---------- Listing ---------- */

interface DeliveryRow {
  id: string;
  subscription_id: string;
  event_id: string;
  event_type: string;
  status: DeliveryStatus;
  attempts: number;
  next_attempt_at: string | null;
  last_status_code: number | null;
  last_error: string | null;
  created_at: string;
  delivered_at: string | null;
  url_host: string;
  agent_id: string;
  agent_name: string;
}

/**
 * Deliveries newest first, each with its attempts (oldest first) and where it went. Filter by one
 * subscription, one owner's agents, one status, or one delivery. `next_before` is set when a full page
 * came back: pass it as `before`.
 */
export async function listDeliveries(
  relay: Relay,
  filter: { deliveryId?: string; subscriptionId?: string; ownerId?: string; status?: DeliveryStatus; before?: string; limit: number },
): Promise<{ deliveries: DeliveryDetail[]; next_before: string | null }> {
  const where: string[] = [];
  const args: unknown[] = [];
  const add = (clause: string, value: unknown) => {
    where.push(clause);
    args.push(value);
  };
  if (filter.deliveryId) add('d.id = ?', filter.deliveryId);
  if (filter.subscriptionId) add('d.subscription_id = ?', filter.subscriptionId);
  if (filter.ownerId) add('a.owner_id = ?', filter.ownerId);
  if (filter.status) add('d.status = ?', filter.status);
  if (filter.before) add('d.id < ?', filter.before);
  const { results } = await relay.db
    .prepare(
      `SELECT d.id, d.subscription_id, d.event_id, d.event_type, d.status, d.attempts, d.next_attempt_at, d.last_status_code, d.last_error, d.created_at, d.delivered_at,
         s.url_host, s.agent_id, a.name AS agent_name
       FROM deliveries d JOIN subscriptions s ON s.id = d.subscription_id JOIN agents a ON a.id = s.agent_id
       ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY d.id DESC LIMIT ?`,
    )
    .bind(...args, filter.limit)
    .all<DeliveryRow>();

  const attempts = new Map<string, DeliveryDetail['attempt_log']>();
  if (results.length) {
    const { results: rows } = await relay.db
      .prepare('SELECT delivery_id, n, started_at, status_code, error, duration_ms FROM delivery_attempts WHERE delivery_id IN (SELECT value FROM json_each(?)) ORDER BY delivery_id, n')
      .bind(JSON.stringify(results.map((r) => r.id)))
      .all<DeliveryDetail['attempt_log'][number] & { delivery_id: string }>();
    for (const { delivery_id, ...attempt } of rows) attempts.set(delivery_id, [...(attempts.get(delivery_id) ?? []), attempt]);
  }
  return {
    deliveries: results.map((r) => ({
      id: r.id,
      subscription_id: r.subscription_id,
      event_id: r.event_id,
      event_type: r.event_type as EventType,
      status: r.status,
      attempts: r.attempts,
      next_attempt_at: r.next_attempt_at,
      last_status_code: r.last_status_code,
      last_error: r.last_error,
      created_at: r.created_at,
      delivered_at: r.delivered_at,
      attempt_log: attempts.get(r.id) ?? [],
      url_host: r.url_host,
      agent_id: r.agent_id,
      agent_name: r.agent_name,
    })),
    next_before: results.length === filter.limit ? results[results.length - 1]!.id : null,
  };
}
