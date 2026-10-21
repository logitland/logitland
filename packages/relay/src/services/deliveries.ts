import { ID_PREFIXES, LIMITS, newId, ulid, type DeliveryDetail, type DeliveryStatus, type EventType } from '@logitland/contracts';
import { signHeaders } from '@logitland/webhooks';
import { iso, type Relay, type Stmt } from '../context';
import { audit } from './audit';
import { getChannel } from './channels';
import { consentedSql } from './conversation';
import { DestinationRefused, preflightDestination } from './destinations';
import { getSettings } from './settings';
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

export type AttemptResult =
  { outcome: 'delivered' } | { outcome: 'retry'; afterSeconds: number } | { outcome: 'failed' | 'dropped' | 'skipped'; reason: string };

/** How long a claimed attempt may run before another worker may take the row. */
const LEASE_MS = 5 * 60_000;
/** The cron scan re-enqueues a due row only if it was last enqueued longer ago than this. */
const REENQUEUE_AFTER_MS = 10 * 60_000;
/** Rows one cron round takes when attempting inline (no Queue), where each attempt costs several queries. */
const DRAIN_ROWS = 100;
/** Rows one cron round re-enqueues (with a Queue), and the most rounds a run makes. */
const DRAIN_ENQUEUE_ROWS = 500;
const DRAIN_ROUNDS = 20;
/** Deliveries one fan-out INSERT creates. */
const FANOUT_ROWS = 500;
/** Ids waiting to be enqueued are flushed at this many. */
const ENQUEUE_FLUSH = 500;
/** Queues: sendBatch takes 100 messages; a retry delay can be 24 hours at most (developers.cloudflare.com/queues/platform/limits). */
const QUEUE_BATCH = 100;
const QUEUE_MAX_DELAY_SECONDS = 86_400;
const RETRY_AFTER_MAX_SECONDS = 86_400;
const FAILED_MESSAGE_RETRY_SECONDS = 60;
const REPLAY_EXTRA_ATTEMPTS = 3;
/** A subscription that has had no successful delivery for this long, while deliveries keep failing, is paused. */
const FAILING_PAUSE_HOURS = 24;
/** Attempts of one Queue batch that run at the same time. */
const BATCH_CONCURRENCY = 10;
const GENERIC_ERROR = 'Internal error while delivering';
const PAUSED = 'Deliveries are switched off by an admin (deliveries_paused). They are sent when it is switched back on.';

/** Exponential backoff with jitter: 30 s, 1 min, 2 min … capped at 6 h, each between half and all of that (equal jitter). */
export function backoffSeconds(attempt: number, random: () => number = Math.random): number {
  const ceiling = Math.min(30 * 2 ** Math.max(0, attempt - 1), 6 * 3600);
  return Math.max(5, Math.round(ceiling * (0.5 + random() / 2)));
}

const chunk = <T>(items: readonly T[], size: number): T[][] =>
  Array.from({ length: Math.ceil(items.length / size) }, (_, i) => items.slice(i * size, (i + 1) * size));

/* ---------- Fan-out and enqueue ---------- */

/**
 * What a fan-out may spend. D1 allows 1,000 queries per Worker invocation and the docs don't say whether the
 * statements of a batch count one by one, so every statement counts. The caller's own work comes on top of this,
 * which is why the share is well under the limit. An event that doesn't finish within it is left unfanned and
 * the refan job continues it (the unique key on a subscription and event makes the repeat harmless).
 */
export interface FanOutBudget {
  queries: number;
  /** Date.now() after which no new round starts. */
  deadline?: number;
  /** Set once a fan-out had to stop early; from then on every later one stops at once. */
  stopped?: boolean;
}
const FANOUT_QUERIES = 300;
export const newFanOutBudget = (deadline?: number): FanOutBudget => ({ queries: FANOUT_QUERIES, ...(deadline === undefined ? {} : { deadline }) });
const spent = (b: FanOutBudget) => b.queries <= 0 || (b.deadline !== undefined && Date.now() >= b.deadline);

function observedAt(event: EventRow): string {
  try {
    const at = (JSON.parse(event.payload) as { observed_at?: unknown }).observed_at;
    if (typeof at === 'string') return at;
  } catch {
    // A payload that isn't JSON falls through to "no limit".
  }
  return '9999-12-31T23:59:59.999Z';
}

/**
 * The event types whose subscribers must hear this one. A removal goes to everyone who gets message text
 * (message.created or message.updated), whether or not they asked for it, so receivers can delete what they stored.
 */
export const isRemoval = (type: string) => type === 'message.deleted' || type === 'message.bulk_deleted';

export function audienceOf(type: string): string[] {
  return type === 'message.deleted' || type === 'message.bulk_deleted' ? [type, 'message.created', 'message.updated'] : [type];
}

// One statement creates a round of deliveries for one event: the active subscriptions of its channel that want
// it and have no delivery for it yet, in subscription order after `after`. Ids are a time prefix and 64 random bits
// (a ULID's shape, so they sort by time), made here so no round trip is needed per row. D1 runs a statement as a unit,
// so nobody can add a delivery between the NOT EXISTS and the insert; the UNIQUE key is the backstop.
const FANOUT_SQL = `INSERT OR IGNORE INTO deliveries (id, subscription_id, event_id, event_type, status, attempts, next_attempt_at, created_at)
  SELECT ? || substr(hex(randomblob(8)), 1, 16), sc.subscription_id, ?, ?, 'pending', 0, ?, ?
  FROM subscription_channels sc
  JOIN subscriptions s ON s.id = sc.subscription_id
  JOIN agents a ON a.id = s.agent_id
  WHERE sc.channel_id = ? AND sc.subscription_id > ?
    AND (s.status = 'active' OR (s.status = 'paused' AND ? = 1)) AND a.status = 'active' AND s.created_at <= ?
    AND (? = 1 OR EXISTS (SELECT 1 FROM json_each(s.events) WHERE value IN (SELECT value FROM json_each(?))))
    AND NOT EXISTS (SELECT 1 FROM deliveries d WHERE d.subscription_id = sc.subscription_id AND d.event_id = ?)
    AND NOT EXISTS (SELECT 1 FROM events t WHERE t.id = ? AND t.subscription_id IS NOT NULL AND t.subscription_id != sc.subscription_id)
  ORDER BY sc.subscription_id LIMIT ?
  RETURNING id, subscription_id`;

/**
 * Creates the event's deliveries a round of FANOUT_ROWS at a time and hands each round's IDs to `sink`.
 * `subscription.gap` goes to every active subscription of the channel, or to the one subscription it is addressed to. A subscription only hears about events
 * from after it existed, even when an event is fanned out late (refanJob). False when the budget ran out first.
 */
export async function fanOutEvent(relay: Relay, event: EventRow, budget: FanOutBudget, sink: (ids: string[]) => Promise<void>): Promise<boolean> {
  const now = relay.now();
  const at = iso(now);
  const prefix = `${ID_PREFIXES.delivery}_${ulid(now.getTime()).slice(0, 10)}`;
  const observed = observedAt(event);
  const audience = JSON.stringify(audienceOf(event.type));
  // Removals also go to paused subscriptions, whose receivers still hold the text they are about.
  const removal = isRemoval(event.type) ? 1 : 0;
  let after = '';
  for (;;) {
    if (spent(budget)) {
      budget.stopped = true;
      return false;
    }
    budget.queries--;
    const { results } = await relay.db
      .prepare(FANOUT_SQL)
      .bind(
        prefix,
        event.id,
        event.type,
        at,
        at,
        event.channel_id,
        after,
        removal,
        observed,
        event.type === 'subscription.gap' ? 1 : 0,
        audience,
        event.id,
        event.id,
        FANOUT_ROWS,
      )
      .all<{ id: string; subscription_id: string }>();
    if (results.length) await sink(results.map((r) => r.id));
    if (results.length < FANOUT_ROWS) return true;
    for (const r of results) if (r.subscription_id > after) after = r.subscription_id;
  }
}

/**
 * Create one delivery per matching, active subscription and put them on the Queue. Returns the new delivery
 * IDs; a repeated call for the same event creates (and enqueues) nothing. An event with more subscribers than
 * one call's budget covers is finished by the refan job. A caller fanning out many events passes one `budget` for all
 * of them and a `sink` that collects the IDs, to enqueue them together (the budget's `stopped` says it ran out).
 */
export async function fanOut(relay: Relay, event: EventRow, opts: { budget?: FanOutBudget; sink?: (ids: string[]) => Promise<void> } = {}): Promise<string[]> {
  const budget = opts.budget ?? newFanOutBudget();
  const created: string[] = [];
  const out = opts.sink ? null : enqueuer(relay, budget);
  await fanOutEvent(relay, event, budget, async (ids) => {
    created.push(...ids);
    await (opts.sink ?? out!.add)(ids);
  });
  await out?.flush();
  if (budget.stopped) relay.log.warn('deliveries.fan_out_partial', { event_id: event.id, deliveries: created.length });
  return created;
}

/** Collects IDs and puts them on the Queue in bounded groups. */
export function enqueuer(relay: Relay, budget?: FanOutBudget) {
  let pending: string[] = [];
  const flush = async () => {
    const ids = pending;
    pending = [];
    if (ids.length) await enqueue(relay, ids, budget);
  };
  return {
    async add(ids: string[]) {
      pending.push(...ids);
      if (pending.length >= ENQUEUE_FLUSH) await flush();
    },
    flush,
  };
}

const MARK_ROWS = 500;

async function markEnqueued(relay: Relay, ids: string[], at: Date, budget?: FanOutBudget): Promise<void> {
  for (const part of chunk(ids, MARK_ROWS)) {
    if (budget) budget.queries--;
    await relay.db.prepare('UPDATE deliveries SET enqueued_at = ? WHERE id IN (SELECT value FROM json_each(?))').bind(iso(at), JSON.stringify(part)).run();
  }
}

/**
 * Put deliveries on the Queue (100 per sendBatch, or one send each) and stamp enqueued_at. A failure is
 * logged and leaves enqueued_at empty, which is exactly what the cron scan looks for. While deliveries are
 * paused nothing is enqueued, for the same reason: the scan sends them once the switch is off.
 */
async function enqueue(relay: Relay, ids: string[], budget?: FanOutBudget): Promise<number> {
  const queue = relay.queue;
  if (!queue || !ids.length) return 0;
  if (budget) budget.queries--;
  if (await deliveriesPaused(relay)) return 0;
  const sent: string[] = [];
  for (const part of chunk(ids, QUEUE_BATCH)) {
    try {
      if (queue.sendBatch) await queue.sendBatch(part.map((id) => ({ body: { delivery_id: id } })));
      else for (const id of part) await queue.send({ delivery_id: id });
    } catch (error) {
      relay.log.error('deliveries.enqueue_failed', { count: part.length, error });
      continue;
    }
    sent.push(...part);
  }
  await markEnqueued(relay, sent, relay.now(), budget);
  return sent.length;
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
  /** When the subscription's current run of unsuccessful attempts began, as read at the start of this attempt. */
  failingSince: string | null;
}

type Settlement =
  | { status: 'delivered'; code: number }
  | { status: 'retrying'; code: number | null; error: string; afterSeconds: number }
  | { status: 'failed'; code: number | null; error: string; disable?: string }
  | { status: 'dropped'; error: string };

function retryOrFail(a: Attempt, code: number | null, reason: string, afterSeconds?: number): Settlement {
  if (a.n >= a.limit) return { status: 'failed', code, error: `${reason}; gave up after ${a.n} attempts` };
  // A receiver can ask for more time, never for less than the backoff.
  return { status: 'retrying', code, error: reason, afterSeconds: Math.max(afterSeconds ?? 0, backoffSeconds(a.n)) };
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
 * happens, so a leased row never sits with nothing written. While deliveries are paused nothing is claimed.
 * A caller that has just read the setting passes `paused` so it isn't read again.
 */
export async function attemptDelivery(relay: Relay, deliveryId: string, opts: { paused?: boolean } = {}): Promise<AttemptResult> {
  if (opts.paused ?? (await deliveriesPaused(relay))) return { outcome: 'skipped', reason: PAUSED };
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

  const attempt: Attempt = {
    deliveryId,
    subscriptionId: claim.subscription_id,
    n: claim.attempts,
    limit: claim.attempt_limit ?? LIMITS.deliveryMaxAttempts,
    startedAt: now,
    failingSince: null,
  };
  try {
    return await deliver(relay, attempt, claim.event_id);
  } catch (error) {
    relay.log.error('delivery.attempt_crashed', { delivery_id: deliveryId, attempt: attempt.n, error });
    return settle(relay, attempt, retryOrFail(attempt, null, GENERIC_ERROR));
  }
}

async function deliver(relay: Relay, a: Attempt, eventId: string): Promise<AttemptResult> {
  const sub = await relay.db.prepare('SELECT * FROM subscriptions WHERE id = ?').bind(a.subscriptionId).first<SubscriptionRow>();
  const agent = sub
    ? await relay.db.prepare('SELECT status, scopes FROM agents WHERE id = ?').bind(sub.agent_id).first<{ status: string; scopes: string }>()
    : null;
  const event = await relay.db
    .prepare('SELECT seq, type, channel_id, payload FROM events WHERE id = ?')
    .bind(eventId)
    .first<{ seq: number; type: string; channel_id: string; payload: string }>();
  const channel = event ? await getChannel(relay, event.channel_id) : null;

  // Re-check before sending: what was true at fan-out may not be now. A removal tells the receiver to delete what it
  // stored, so it still goes out when the channel has closed, the scope was taken away or the subscription is paused.
  const removal = event ? isRemoval(event.type) : false;
  const drop = (error: string) => settle(relay, a, { status: 'dropped', error });
  if (sub) a.failingSince = sub.failing_since;
  if (!sub || sub.status === 'disabled' || (sub.status === 'paused' && !removal)) return drop('The subscription is no longer active');
  if (agent?.status !== 'active') return drop('The agent is no longer active');
  if (!removal && !(JSON.parse(agent.scopes) as string[]).includes('messages:read')) return drop('The agent no longer has messages:read');
  if (!event) return drop('The event is no longer available');
  if (!removal && (!channel || channel.agent_access === 'off')) return drop('The channel is no longer open to agents');
  // A person who left takes their words back, even if the clean-up hasn't reached this event yet.
  if (
    (event.type === 'message.created' || event.type === 'message.updated') &&
    (await relay.db
      .prepare(
        `SELECT 1 AS gone FROM conversation c WHERE c.message_id = (SELECT message_id FROM events WHERE id = ?) AND c.author_kind = 'human' AND c.discord_user_id IS NOT NULL AND NOT ${consentedSql('c')}`,
      )
      .bind(eventId)
      .first())
  )
    return drop('The person who wrote this message has since left the mirror');

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
  if (code === 429 || code === 408 || code >= 500)
    return settle(relay, a, retryOrFail(a, code, `${code} from the destination`, retryAfterSeconds(res.headers.get('retry-after'), relay.now())));
  // Redirects are never followed, and other 4xx won't get better by waiting.
  return settle(relay, a, { status: 'failed', code, error: code >= 300 && code < 400 ? `${code} redirect not followed` : `${code} from the destination` });
}

/**
 * An audit entry that is written only if `when` is true at the moment the statement runs, inside the same batch as
 * the change it records. Deciding from a read taken earlier would let two concurrent failures both audit a pause
 * (or neither), so the entry follows the batch's own state: it is the first statement to look at the subscription,
 * before the update that changes it.
 */
function auditWhen(relay: Relay, entry: { action: string; subscriptionId: string; reason: string }, when: string, ...args: unknown[]): Stmt {
  return relay.db
    .prepare(
      `INSERT INTO audit_log (id, actor_type, actor_id, action, target_type, target_id, reason, diff, created_at)
       SELECT ?, 'system', 'relay', ?, 'subscription', ?, ?, NULL, ? WHERE ${when}`,
    )
    .bind(newId('audit'), entry.action, entry.subscriptionId, entry.reason, iso(relay.now()), ...args);
}

/**
 * Record an attempt's outcome: the delivery row, the attempt row and whatever it means for the
 * subscription, in one batch. Only deliveries that end `failed` count toward the failure streak; retries
 * don't, and neither do drops, but any unsuccessful attempt starts (or continues) the run that pauses the
 * subscription after FAILING_PAUSE_HOURS without a success. A pause or a disable is audited once, by the batch
 * that makes it. A delivery that was dropped, scrubbed or finished while its attempt ran keeps that state, and
 * the attempt changes nothing about the subscription.
 */
async function settle(relay: Relay, a: Attempt, s: Settlement): Promise<AttemptResult> {
  const finished = relay.now();
  const at = iso(finished);
  const code = 'code' in s ? s.code : null;
  const error = 'error' in s ? s.error : null;
  const next = s.status === 'retrying' ? iso(new Date(finished.getTime() + s.afterSeconds * 1000)) : null;
  // True while the delivery is in the state this settlement gave it, which is only so if nothing else changed it first.
  const live = 'EXISTS (SELECT 1 FROM deliveries WHERE id = ? AND status = ?)';
  const liveArgs = [a.deliveryId, s.status];
  const stmts: Stmt[] = [
    relay.db
      .prepare(
        `UPDATE deliveries SET status = ?, last_status_code = ?, last_error = ?, next_attempt_at = ?, delivered_at = COALESCE(?, delivered_at)
         WHERE id = ? AND status IN ('pending', 'retrying')`,
      )
      .bind(s.status, code, error, next, s.status === 'delivered' ? at : null, a.deliveryId),
    relay.db
      .prepare('INSERT OR IGNORE INTO delivery_attempts (delivery_id, n, started_at, status_code, error, duration_ms) VALUES (?, ?, ?, ?, ?, ?)')
      .bind(a.deliveryId, a.n, iso(a.startedAt), code, error, Math.max(0, finished.getTime() - a.startedAt.getTime())),
  ];
  /** Index of the audit statement whose change count says whether this batch moved the subscription. */
  let moved = -1;
  let movedAction = '';

  if (s.status === 'delivered') {
    stmts.push(
      relay.db
        .prepare(
          `UPDATE subscriptions SET failure_streak = 0, failing_since = NULL WHERE id = ? AND (failure_streak != 0 OR failing_since IS NOT NULL) AND ${live}`,
        )
        .bind(a.subscriptionId, ...liveArgs),
    );
  } else if (s.status === 'failed' && s.disable) {
    moved = stmts.length;
    movedAction = 'subscription.disabled';
    stmts.push(
      auditWhen(
        relay,
        { action: movedAction, subscriptionId: a.subscriptionId, reason: s.disable },
        `EXISTS (SELECT 1 FROM subscriptions WHERE id = ? AND status != 'disabled') AND ${live}`,
        a.subscriptionId,
        ...liveArgs,
      ),
      relay.db
        .prepare(`UPDATE subscriptions SET status = 'disabled', paused_reason = ? WHERE id = ? AND status != 'disabled' AND ${live}`)
        .bind(s.disable, a.subscriptionId, ...liveArgs),
      dropPendingStmt(relay, a.subscriptionId, 'The subscription was disabled', 'disabled'),
      relay.db
        .prepare("DELETE FROM subscription_channels WHERE subscription_id = ? AND EXISTS (SELECT 1 FROM subscriptions WHERE id = ? AND status = 'disabled')")
        .bind(a.subscriptionId, a.subscriptionId),
    );
  } else if (s.status === 'failed' || s.status === 'retrying') {
    const limit = LIMITS.pauseAfterFailedDeliveries;
    const bump = s.status === 'failed' ? 1 : 0;
    const cutoff = iso(new Date(finished.getTime() - FAILING_PAUSE_HOURS * 3_600_000));
    const byCount = `Paused after ${limit} failed deliveries in a row. Fix the destination, then resume it.`;
    const byTime = `Paused because nothing was delivered for ${FAILING_PAUSE_HOURS} hours. Fix the destination, then resume it.`;
    const reasonSql = 'CASE WHEN failure_streak + ? >= ? THEN ? ELSE ? END';
    const reasonArgs = [bump, limit, byCount, byTime];
    const dueSql = "status = 'active' AND (failure_streak + ? >= ? OR (failing_since IS NOT NULL AND failing_since <= ?))";
    const dueArgs = [bump, limit, cutoff];
    moved = stmts.length;
    movedAction = 'subscription.paused';
    stmts.push(
      relay.db
        .prepare(
          `INSERT INTO audit_log (id, actor_type, actor_id, action, target_type, target_id, reason, diff, created_at)
           SELECT ?, 'system', 'relay', ?, 'subscription', id, ${reasonSql}, NULL, ? FROM subscriptions WHERE id = ? AND ${dueSql} AND ${live}`,
        )
        .bind(newId('audit'), movedAction, ...reasonArgs, at, a.subscriptionId, ...dueArgs, ...liveArgs),
      relay.db
        .prepare(
          `UPDATE subscriptions SET failure_streak = failure_streak + ?, failing_since = COALESCE(failing_since, ?),
             status = CASE WHEN ${dueSql} THEN 'paused' ELSE status END,
             paused_reason = CASE WHEN ${dueSql} THEN ${reasonSql} ELSE paused_reason END,
             paused_at = CASE WHEN ${dueSql} THEN ? ELSE paused_at END
           WHERE id = ? AND ${live}`,
        )
        .bind(bump, at, ...dueArgs, ...dueArgs, ...reasonArgs, ...dueArgs, at, a.subscriptionId, ...liveArgs),
    );
    // Only a subscription that is paused now (by this batch or an earlier one) loses what was waiting, and not the removals.
    // A retry only needs the check when a pause by time is possible.
    if (bump || (a.failingSince !== null && a.failingSince <= cutoff))
      stmts.push(dropPendingStmt(relay, a.subscriptionId, 'The subscription was paused', 'paused', true));
  }

  const results = await relay.db.batch(stmts);
  if (results[0]!.meta.changes !== 1) {
    // The delivery was settled by someone else while this attempt ran (dropped by a scrub, a pause or a removal).
    return { outcome: 'skipped', reason: 'The delivery was dropped or finished while it was being attempted' };
  }
  if (moved >= 0 && results[moved]!.meta.changes === 1) relay.log.warn(movedAction, { subscription_id: a.subscriptionId, delivery_id: a.deliveryId });
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

const deliveriesPaused = async (relay: Relay) => (await getSettings(relay)).deliveries_paused;

/**
 * Cron: recover deliveries that are due. In Queue mode, re-enqueue those never enqueued or last enqueued
 * over 10 minutes ago (the Queue normally holds retries itself), up to DRAIN_ENQUEUE_ROWS a round and
 * DRAIN_ROUNDS rounds a run, so a backlog (after a pause or a Queue outage) clears faster than new events arrive.
 * Without a Queue, attempt up to DRAIN_ROWS here. Stops early at `deadline`. Does nothing while deliveries are
 * paused. Returns how many rows it took.
 */
export async function drainDue(relay: Relay, ctx: { deadline?: number } = {}): Promise<number> {
  if (await deliveriesPaused(relay)) return 0;
  const queued = Boolean(relay.queue);
  const limit = queued ? DRAIN_ENQUEUE_ROWS : DRAIN_ROWS;
  const late = () => ctx.deadline !== undefined && Date.now() >= ctx.deadline;
  let total = 0;
  for (let round = 0; round < (queued ? DRAIN_ROUNDS : 1); round++) {
    const now = relay.now();
    // One status at a time, so deliveries_due serves the order and only `limit` rows are read, not the whole backlog.
    const due: { id: string; next_attempt_at: string }[] = [];
    for (const status of ['pending', 'retrying']) {
      const { results } = await relay.db
        .prepare(
          `SELECT id, next_attempt_at FROM deliveries
           WHERE status = ? AND next_attempt_at <= ? ${queued ? 'AND (enqueued_at IS NULL OR enqueued_at < ?)' : ''}
           ORDER BY next_attempt_at LIMIT ?`,
        )
        .bind(status, ...(queued ? [iso(now), iso(new Date(now.getTime() - REENQUEUE_AFTER_MS)), limit] : [iso(now), limit]))
        .all<{ id: string; next_attempt_at: string }>();
      due.push(...results);
    }
    due.sort((x, y) => (x.next_attempt_at < y.next_attempt_at ? -1 : x.next_attempt_at > y.next_attempt_at ? 1 : 0));
    const ids = due.slice(0, limit).map((r) => r.id);
    total += ids.length;
    if (queued) {
      // Rows the Queue refused stay due, so another round would only ask again.
      if ((await enqueue(relay, ids)) < ids.length) break;
    } else {
      for (const id of ids) {
        if (late()) break;
        try {
          await attemptDelivery(relay, id, { paused: false });
        } catch (error) {
          relay.log.error('deliveries.drain_failed', { delivery_id: id, error });
        }
      }
    }
    if (ids.length < limit || late()) break;
  }
  return total;
}

/**
 * Admin replay: same webhook-id, a new attempt timestamp, after the same checks as any attempt. A row
 * under an active lease (or waiting for its next retry) is refused. Replaying an exhausted delivery grants
 * three more attempts. Refused while deliveries are paused.
 */
export async function replayDelivery(relay: Relay, deliveryId: string, adminId?: string): Promise<AttemptResult> {
  if (await deliveriesPaused(relay)) return { outcome: 'skipped', reason: PAUSED };
  const at = iso(relay.now());
  const r = await relay.db
    .prepare(
      `UPDATE deliveries SET status = 'retrying', next_attempt_at = ?, enqueued_at = NULL,
         attempt_limit = CASE WHEN attempts >= COALESCE(attempt_limit, ?) THEN attempts + ? ELSE attempt_limit END
       WHERE id = ? AND (status IN ('failed', 'dropped', 'delivered') OR (status IN ('pending', 'retrying') AND next_attempt_at <= ?))`,
    )
    .bind(at, LIMITS.deliveryMaxAttempts, REPLAY_EXTRA_ATTEMPTS, deliveryId, at)
    .run();
  if (r.meta.changes !== 1)
    return { outcome: 'skipped', reason: 'That delivery is being attempted or is waiting for its next retry. Replay it once it has finished.' };
  await audit(relay, {
    actor_type: adminId ? 'admin' : 'system',
    actor_id: adminId ?? 'relay',
    action: 'delivery.replayed',
    target_type: 'delivery',
    target_id: deliveryId,
  });
  return attemptDelivery(relay, deliveryId, { paused: false });
}

/**
 * Queue consumer body. Each message is handled on its own: one that throws is retried after 60 seconds and
 * doesn't affect the others. A delivery that wants a retry is handed back to the Queue with its delay
 * (capped at the Queues maximum of 24 hours). While deliveries are paused the messages are acknowledged and their
 * rows made due for the cron scan again, which sends them once the switch is off.
 */
export async function handleDeliveryBatch(
  relay: Relay,
  messages: readonly { body: unknown; ack(): void; retry(options?: { delaySeconds?: number }): void }[],
): Promise<AttemptResult[]> {
  const out: AttemptResult[] = [];
  const paused = await deliveriesPaused(relay);
  if (paused) {
    const ids = messages.map((m) => (m.body as { delivery_id?: unknown } | null)?.delivery_id).filter((id): id is string => typeof id === 'string');
    if (ids.length) {
      await relay.db
        .prepare("UPDATE deliveries SET enqueued_at = NULL WHERE status IN ('pending', 'retrying') AND id IN (SELECT value FROM json_each(?))")
        .bind(JSON.stringify(ids))
        .run();
    }
    for (const m of messages) {
      m.ack();
      out.push({ outcome: 'skipped', reason: PAUSED });
    }
    return out;
  }
  // A slow receiver holds up only its own delivery, not the rest of the batch.
  for (const part of chunk(messages, BATCH_CONCURRENCY)) {
    const results = await Promise.all(
      part.map(async (m): Promise<AttemptResult | null> => {
        try {
          const id = (m.body as { delivery_id?: unknown } | null)?.delivery_id;
          if (typeof id !== 'string') {
            m.ack();
            return null;
          }
          const result = await attemptDelivery(relay, id, { paused: false });
          if (result.outcome === 'retry') {
            const delaySeconds = Math.min(result.afterSeconds, QUEUE_MAX_DELAY_SECONDS);
            // The Queue now holds this retry, so the cron scan should leave the row alone until well after it is due.
            await markEnqueued(relay, [id], new Date(relay.now().getTime() + delaySeconds * 1000));
            m.retry({ delaySeconds });
          } else {
            m.ack();
          }
          return result;
        } catch (error) {
          relay.log.error('deliveries.message_failed', { error });
          m.retry({ delaySeconds: FAILED_MESSAGE_RETRY_SECONDS });
          return { outcome: 'skipped', reason: 'Unexpected error; retrying in 60 s' };
        }
      }),
    );
    for (const r of results) if (r) out.push(r);
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
      .prepare(
        'SELECT delivery_id, n, started_at, status_code, error, duration_ms FROM delivery_attempts WHERE delivery_id IN (SELECT value FROM json_each(?)) ORDER BY delivery_id, n',
      )
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
