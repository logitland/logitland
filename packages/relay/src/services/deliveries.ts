import { LIMITS, newId, type DeliveryDetail, type DeliveryStatus } from '@logitland/contracts';
import { signHeaders } from '@logitland/webhooks';
import { iso, type DeliveryMessage, type Relay, type Stmt } from '../context';
import { audit } from './audit';
import { DestinationRefused, preflightDestination } from './destinations';
import { takeDigests } from './feed';
import { getSettings } from './settings';
import { wakeStreams } from './streams';
import { previousSecretAad, secretAad, urlAad, type WebhookRow } from './webhook';

// Webhook delivery (#11): each digest an agent's subscriptions are due to give it becomes one signed POST to its webhook,
// recorded in the delivery ledger with its body, so a retry sends exactly the same bytes under the same webhook-id. With a
// Queue bound, pushes and retries go through it; without one (tests, local development) they run inline and the cron
// scan catches up. Every attempt claims its row with a compare-and-set first, so a delivery is never sent twice at once.
// Receivers must still dedupe on webhook-id: an attempt that times out may have reached them.

export type AttemptResult =
  { outcome: 'delivered' } | { outcome: 'retry'; afterSeconds: number } | { outcome: 'failed' | 'dropped' | 'skipped'; reason: string };

/** How long a claimed attempt may run before another worker may take the row. */
const LEASE_MS = 5 * 60_000;
/** The cron scan re-enqueues a due row only if it was last enqueued longer ago than this. */
const REENQUEUE_AFTER_MS = 10 * 60_000;
/** Rows (or agents) one cron round takes. */
const DRAIN_ROWS = 100;
/** Queues: sendBatch takes 100 messages; a delay can be 24 hours at most (developers.cloudflare.com/queues/platform/limits). */
const QUEUE_BATCH = 100;
const QUEUE_MAX_DELAY_SECONDS = 86_400;
const RETRY_AFTER_MAX_SECONDS = 86_400;
const FAILED_MESSAGE_RETRY_SECONDS = 60;
const REPLAY_EXTRA_ATTEMPTS = 3;
/** A webhook that has had no successful delivery for this long, while deliveries keep failing, is paused. */
const FAILING_PAUSE_HOURS = 24;
/** While a webhook is paused or its agent off, its deliveries wait and are looked at again this often. */
const WAIT_WHILE_STOPPED_MS = 3_600_000;
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

const deliveriesPaused = async (relay: Relay) => (await getSettings(relay)).deliveries_paused;

async function send(relay: Relay, bodies: { body: DeliveryMessage; delaySeconds?: number }[]): Promise<boolean> {
  const queue = relay.queue!;
  try {
    for (const part of chunk(bodies, QUEUE_BATCH)) {
      if (queue.sendBatch) await queue.sendBatch(part);
      else for (const m of part) await queue.send(m.body, m.delaySeconds === undefined ? undefined : { delaySeconds: m.delaySeconds });
    }
    return true;
  } catch (error) {
    relay.log.error('deliveries.enqueue_failed', { count: bodies.length, error });
    return false;
  }
}

/* ---------- Pushing digests ---------- */

/**
 * Tells the transports that subscriptions are due. Webhook agents get a push: now for what is due now, and, for what falls
 * due within the minute (short frequencies), a delayed Queue message; the cron scan covers the rest. Called after events
 * are recorded. Without a Queue the pushes run here.
 */
export async function wake(relay: Relay): Promise<void> {
  const now = relay.now().getTime();
  const { results } = await relay.db
    .prepare(
      `SELECT s.agent_id, MIN(s.next_due_ms) AS due FROM subscriptions s JOIN agent_webhooks w ON w.agent_id = s.agent_id AND w.status = 'active'
       WHERE s.next_due_ms IS NOT NULL AND s.next_due_ms < ? GROUP BY s.agent_id`,
    )
    .bind(now + 60_000)
    .all<{ agent_id: string; due: number }>();
  if (results.length) {
    if (relay.queue && !(await deliveriesPaused(relay))) {
      await send(
        relay,
        results.map((r) => ({ body: { push: r.agent_id }, ...(r.due > now ? { delaySeconds: Math.ceil((r.due - now) / 1000) } : {}) })),
      );
    } else if (!relay.queue) {
      for (const r of results) if (r.due <= now) await pushDue(relay, r.agent_id);
    }
  }
  await wakeStreams(relay);
}

interface PushAgent {
  id: string;
  status: string;
  level: number;
  owner_id: string | null;
  daily_event_cap: number | null;
  /** JSON array of the agent's scopes. */
  scopes: string;
}

/** Takes the agent's due digests and sends each to its webhook as a delivery. Returns how many deliveries it made. */
export async function pushDue(relay: Relay, agentId: string): Promise<number> {
  if (await deliveriesPaused(relay)) return 0;
  const agent = await relay.db
    .prepare(
      "SELECT a.id, a.status, a.level, a.owner_id, a.daily_event_cap, a.scopes FROM agents a JOIN agent_webhooks w ON w.agent_id = a.id AND w.status = 'active' WHERE a.id = ?",
    )
    .bind(agentId)
    .first<PushAgent>();
  if (!agent || agent.status !== 'active' || !(JSON.parse(agent.scopes) as string[]).includes('messages:read')) return 0;
  const { digests } = await takeDigests(relay, agent, 'due');
  if (!digests.length) return 0;
  const at = iso(relay.now());
  const rows = digests.map((d) => ({ id: newId('delivery'), digest: d }));
  await relay.db.batch(
    rows.map(({ id, digest }) =>
      relay.db
        .prepare(
          "INSERT INTO deliveries (id, agent_id, subscription_id, event_count, body, status, next_attempt_at, created_at) VALUES (?, ?, ?, ?, ?, 'pending', ?, ?)",
        )
        .bind(id, agent.id, digest.subscription_id, digest.events.length, JSON.stringify(digest), at, at),
    ),
  );
  if (relay.queue) {
    if (
      await send(
        relay,
        rows.map(({ id }) => ({ body: { delivery_id: id } })),
      )
    )
      await markEnqueued(
        relay,
        rows.map((r) => r.id),
        relay.now(),
      );
  } else for (const { id } of rows) await attemptDelivery(relay, id, { paused: false });
  return rows.length;
}

async function markEnqueued(relay: Relay, ids: string[], at: Date): Promise<void> {
  await relay.db.prepare('UPDATE deliveries SET enqueued_at = ? WHERE id IN (SELECT value FROM json_each(?))').bind(iso(at), JSON.stringify(ids)).run();
}

/* ---------- Attempts ---------- */

interface Claim {
  agent_id: string;
  body: string;
  attempts: number;
  attempt_limit: number | null;
}

interface Attempt {
  deliveryId: string;
  agentId: string;
  /** This attempt's number (1-based). */
  n: number;
  /** Attempts allowed in all; an admin replay of an exhausted delivery raises it. */
  limit: number;
  startedAt: Date;
  /** When the webhook's current run of unsuccessful attempts began, as read at the start of this attempt. */
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
 * Tries to send one delivery. Safe to run twice at once: the claim is a compare-and-set that also leases the row, so the
 * second caller gets `skipped`. A delivery whose webhook is paused or whose agent is off waits (it is looked at again in an
 * hour) without spending an attempt; one whose webhook is gone is dropped. While deliveries are paused nothing is claimed.
 */
export async function attemptDelivery(relay: Relay, deliveryId: string, opts: { paused?: boolean } = {}): Promise<AttemptResult> {
  if (opts.paused ?? (await deliveriesPaused(relay))) return { outcome: 'skipped', reason: PAUSED };
  const now = relay.now();
  const waiting = await relay.db
    .prepare(
      `UPDATE deliveries SET next_attempt_at = ? WHERE id = ? AND status IN ('pending', 'retrying') AND (next_attempt_at IS NULL OR next_attempt_at <= ?)
         AND EXISTS (SELECT 1 FROM agent_webhooks w JOIN agents a ON a.id = w.agent_id WHERE w.agent_id = deliveries.agent_id AND (w.status = 'paused' OR a.status != 'active'))`,
    )
    .bind(iso(new Date(now.getTime() + WAIT_WHILE_STOPPED_MS)), deliveryId, iso(now))
    .run();
  if (waiting.meta.changes > 0) return { outcome: 'skipped', reason: 'The webhook is paused or the agent is off; the delivery waits' };
  const claim = await relay.db
    .prepare(
      `UPDATE deliveries SET attempts = attempts + 1, next_attempt_at = ?
       WHERE id = ? AND status IN ('pending', 'retrying') AND (next_attempt_at IS NULL OR next_attempt_at <= ?)
       RETURNING agent_id, body, attempts, attempt_limit`,
    )
    .bind(iso(new Date(now.getTime() + LEASE_MS)), deliveryId, iso(now))
    .first<Claim>();
  if (!claim) return { outcome: 'skipped', reason: 'Not due, or already handled' };

  const attempt: Attempt = {
    deliveryId,
    agentId: claim.agent_id,
    n: claim.attempts,
    limit: claim.attempt_limit ?? LIMITS.deliveryMaxAttempts,
    startedAt: now,
    failingSince: null,
  };
  try {
    return await deliver(relay, attempt, claim.body);
  } catch (error) {
    relay.log.error('delivery.attempt_crashed', { delivery_id: deliveryId, attempt: attempt.n, error });
    return settle(relay, attempt, retryOrFail(attempt, null, GENERIC_ERROR));
  }
}

async function deliver(relay: Relay, a: Attempt, body: string): Promise<AttemptResult> {
  const hook = await relay.db.prepare('SELECT * FROM agent_webhooks WHERE agent_id = ?').bind(a.agentId).first<WebhookRow>();
  if (!hook || hook.status === 'disabled') return settle(relay, a, { status: 'dropped', error: 'The webhook was removed or disabled' });
  a.failingSince = hook.failing_since;

  const target = await relay.secrets.open(hook.url_ciphertext, urlAad(hook));
  let url: URL;
  try {
    url = await preflightDestination(target, relay.resolver, relay.config.blockedHosts);
  } catch (err) {
    if (err instanceof DestinationRefused) return settle(relay, a, retryOrFail(a, null, `Refused at send time: ${err.message}`));
    throw err;
  }
  const secrets = [await relay.secrets.open(hook.secret_ciphertext, secretAad(hook))];
  if (hook.secret_previous_ciphertext && hook.secret_previous_until && hook.secret_previous_until > iso(relay.now()))
    secrets.push(await relay.secrets.open(hook.secret_previous_ciphertext, previousSecretAad(hook)));

  let res: Response;
  try {
    res = await relay.fetch(url, {
      method: 'POST',
      redirect: 'manual',
      // A fresh header allowlist: never forward tokens, Discord credentials, cookies or anything else.
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
  if (code === 410)
    return settle(relay, a, {
      status: 'failed',
      code,
      error: '410 Gone from the destination; the webhook was disabled',
      disable: 'The destination answered 410 Gone, so the relay stopped sending. Set your webhook again with PUT /v1/delivery.',
    });
  if (code === 429 || code === 408 || code >= 500)
    return settle(relay, a, retryOrFail(a, code, `${code} from the destination`, retryAfterSeconds(res.headers.get('retry-after'), relay.now())));
  // Redirects are never followed, and other 4xx won't get better by waiting.
  return settle(relay, a, { status: 'failed', code, error: code >= 300 && code < 400 ? `${code} redirect not followed` : `${code} from the destination` });
}

/**
 * Records an attempt's outcome: the delivery row, the attempt row and what it means for the webhook, in one batch. Only
 * deliveries that end `failed` count toward the failure streak; retries don't, but any unsuccessful attempt starts (or
 * continues) the run that pauses the webhook after FAILING_PAUSE_HOURS without a success. A pause or a disable is audited
 * once, by the batch that makes it, and only while the delivery is still in the state this settlement gave it.
 */
async function settle(relay: Relay, a: Attempt, s: Settlement): Promise<AttemptResult> {
  const finished = relay.now();
  const at = iso(finished);
  const code = 'code' in s ? s.code : null;
  const error = 'error' in s ? s.error : null;
  const next = s.status === 'retrying' ? iso(new Date(finished.getTime() + s.afterSeconds * 1000)) : null;
  const live = 'EXISTS (SELECT 1 FROM deliveries WHERE id = ? AND status = ?)';
  const liveArgs = [a.deliveryId, s.status];
  const audit = (action: string, reasonSql: string, reasonArgs: unknown[], when: string, whenArgs: unknown[]): Stmt =>
    relay.db
      .prepare(
        `INSERT INTO audit_log (id, actor_type, actor_id, action, target_type, target_id, reason, diff, created_at)
         SELECT ?, 'system', 'relay', ?, 'agent', agent_id, ${reasonSql}, NULL, ? FROM agent_webhooks WHERE agent_id = ? AND ${when} AND ${live}`,
      )
      .bind(newId('audit'), action, ...reasonArgs, at, a.agentId, ...whenArgs, ...liveArgs);
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
  let moved = -1;
  let movedAction = '';
  if (s.status === 'delivered') {
    stmts.push(
      relay.db
        .prepare(
          `UPDATE agent_webhooks SET failure_streak = 0, failing_since = NULL WHERE agent_id = ? AND (failure_streak != 0 OR failing_since IS NOT NULL) AND ${live}`,
        )
        .bind(a.agentId, ...liveArgs),
    );
  } else if (s.status === 'failed' && s.disable) {
    moved = stmts.length;
    movedAction = 'webhook.disabled';
    stmts.push(
      audit(movedAction, '?', [s.disable], "status != 'disabled'", []),
      relay.db
        .prepare(`UPDATE agent_webhooks SET status = 'disabled', paused_reason = ?, updated_at = ? WHERE agent_id = ? AND status != 'disabled' AND ${live}`)
        .bind(s.disable, at, a.agentId, ...liveArgs),
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
    movedAction = 'webhook.paused';
    stmts.push(
      audit(movedAction, reasonSql, reasonArgs, dueSql, dueArgs),
      relay.db
        .prepare(
          `UPDATE agent_webhooks SET failure_streak = failure_streak + ?, failing_since = COALESCE(failing_since, ?),
             status = CASE WHEN ${dueSql} THEN 'paused' ELSE status END,
             paused_reason = CASE WHEN ${dueSql} THEN ${reasonSql} ELSE paused_reason END,
             paused_at = CASE WHEN ${dueSql} THEN ? ELSE paused_at END
           WHERE agent_id = ? AND ${live}`,
        )
        .bind(bump, at, ...dueArgs, ...dueArgs, ...reasonArgs, ...dueArgs, at, a.agentId, ...liveArgs),
    );
  }

  const results = await relay.db.batch(stmts);
  if (results[0]!.meta.changes === 0) return { outcome: 'skipped', reason: 'The delivery was dropped or finished while it was being attempted' };
  if (moved >= 0 && results[moved]!.meta.changes > 0) relay.log.warn(movedAction, { agent_id: a.agentId, delivery_id: a.deliveryId });
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
 * Cron: pushes for webhook agents whose subscriptions are due (frequencies of a minute and longer are served from here),
 * and deliveries that are due again: re-enqueued when they were never enqueued or last enqueued over 10 minutes ago, or
 * attempted here without a Queue. Does nothing while deliveries are paused. Returns how many it took.
 */
export async function drainDue(relay: Relay, ctx: { deadline?: number } = {}): Promise<number> {
  if (await deliveriesPaused(relay)) return 0;
  const now = relay.now();
  const late = () => ctx.deadline !== undefined && Date.now() >= ctx.deadline;
  const { results: agents } = await relay.db
    .prepare(
      `SELECT DISTINCT s.agent_id FROM subscriptions s JOIN agent_webhooks w ON w.agent_id = s.agent_id AND w.status = 'active'
       WHERE s.next_due_ms IS NOT NULL AND s.next_due_ms <= ? LIMIT ?`,
    )
    .bind(now.getTime(), DRAIN_ROWS)
    .all<{ agent_id: string }>();
  if (relay.queue)
    await send(
      relay,
      agents.map((a) => ({ body: { push: a.agent_id } })),
    );
  else for (const a of agents) if (!late()) await pushDue(relay, a.agent_id);

  const queued = Boolean(relay.queue);
  const { results: due } = await relay.db
    .prepare(
      `SELECT id FROM deliveries WHERE status IN ('pending', 'retrying') AND next_attempt_at <= ? ${queued ? 'AND (enqueued_at IS NULL OR enqueued_at < ?)' : ''}
       ORDER BY next_attempt_at LIMIT ?`,
    )
    .bind(iso(now), ...(queued ? [iso(new Date(now.getTime() - REENQUEUE_AFTER_MS))] : []), DRAIN_ROWS)
    .all<{ id: string }>();
  if (queued) {
    if (
      due.length &&
      (await send(
        relay,
        due.map((d) => ({ body: { delivery_id: d.id } })),
      ))
    )
      await markEnqueued(
        relay,
        due.map((d) => d.id),
        now,
      );
  } else {
    for (const { id } of due) {
      if (late()) break;
      try {
        await attemptDelivery(relay, id, { paused: false });
      } catch (error) {
        relay.log.error('deliveries.drain_failed', { delivery_id: id, error });
      }
    }
  }
  return agents.length + due.length;
}

/**
 * Admin replay: same webhook-id, a new attempt timestamp, after the same checks as any attempt. A row under an active
 * lease (or waiting for its next retry) is refused. Replaying an exhausted delivery grants three more attempts.
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
  if (r.meta.changes === 0)
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
 * Queue consumer body: `{push: agent}` takes the agent's due digests, `{delivery_id}` attempts one delivery. Each message is
 * handled on its own: one that throws is retried after 60 seconds. A delivery that wants a retry is handed back to the
 * Queue with its delay. While deliveries are paused the messages are acknowledged; the cron scan sends everything later.
 */
export async function handleDeliveryBatch(
  relay: Relay,
  messages: readonly { body: unknown; ack(): void; retry(options?: { delaySeconds?: number }): void }[],
): Promise<AttemptResult[]> {
  const out: AttemptResult[] = [];
  if (await deliveriesPaused(relay)) {
    const ids = messages.map((m) => (m.body as { delivery_id?: unknown } | null)?.delivery_id).filter((id): id is string => typeof id === 'string');
    if (ids.length)
      await relay.db
        .prepare("UPDATE deliveries SET enqueued_at = NULL WHERE status IN ('pending', 'retrying') AND id IN (SELECT value FROM json_each(?))")
        .bind(JSON.stringify(ids))
        .run();
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
          const body = m.body as Partial<{ delivery_id: unknown; push: unknown }> | null;
          if (typeof body?.push === 'string') {
            await pushDue(relay, body.push);
            m.ack();
            return null;
          }
          if (typeof body?.delivery_id !== 'string') {
            m.ack();
            return null;
          }
          const id = body.delivery_id;
          const result = await attemptDelivery(relay, id, { paused: false });
          if (result.outcome === 'retry') {
            const delaySeconds = Math.min(result.afterSeconds, QUEUE_MAX_DELAY_SECONDS);
            // The Queue now holds this retry, so the cron scan should leave the row alone until well after it is due.
            await markEnqueued(relay, [id], new Date(relay.now().getTime() + delaySeconds * 1000));
            m.retry({ delaySeconds });
          } else m.ack();
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
  agent_id: string;
  subscription_id: string;
  event_count: number;
  status: DeliveryStatus;
  attempts: number;
  next_attempt_at: string | null;
  last_status_code: number | null;
  last_error: string | null;
  created_at: string;
  delivered_at: string | null;
  url_host: string | null;
  agent_name: string;
}

/**
 * Deliveries newest first, each with its attempts (oldest first) and where it went. Filter by one agent, one owner's
 * agents, one status, or one delivery. `next_before` is set when a full page came back: pass it as `before`.
 */
export async function listDeliveries(
  relay: Relay,
  filter: { deliveryId?: string; agentId?: string; ownerId?: string; status?: DeliveryStatus; before?: string; limit: number },
): Promise<{ deliveries: DeliveryDetail[]; next_before: string | null }> {
  const where: string[] = [];
  const args: unknown[] = [];
  const add = (clause: string, value: unknown) => {
    where.push(clause);
    args.push(value);
  };
  if (filter.deliveryId) add('d.id = ?', filter.deliveryId);
  if (filter.agentId) add('d.agent_id = ?', filter.agentId);
  if (filter.ownerId) add('a.owner_id = ?', filter.ownerId);
  if (filter.status) add('d.status = ?', filter.status);
  if (filter.before) add('d.id < ?', filter.before);
  const { results } = await relay.db
    .prepare(
      `SELECT d.id, d.agent_id, d.subscription_id, d.event_count, d.status, d.attempts, d.next_attempt_at, d.last_status_code, d.last_error, d.created_at, d.delivered_at,
         w.url_host, a.name AS agent_name
       FROM deliveries d JOIN agents a ON a.id = d.agent_id LEFT JOIN agent_webhooks w ON w.agent_id = d.agent_id
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
      id: r.id as DeliveryDetail['id'],
      subscription_id: r.subscription_id as DeliveryDetail['subscription_id'],
      event_count: r.event_count,
      status: r.status,
      attempts: r.attempts,
      next_attempt_at: r.next_attempt_at,
      last_status_code: r.last_status_code,
      last_error: r.last_error,
      created_at: r.created_at,
      delivered_at: r.delivered_at,
      attempt_log: attempts.get(r.id) ?? [],
      url_host: r.url_host ?? '',
      agent_id: r.agent_id as DeliveryDetail['agent_id'],
      agent_name: r.agent_name,
    })),
    next_before: results.length === filter.limit ? results[results.length - 1]!.id : null,
  };
}
