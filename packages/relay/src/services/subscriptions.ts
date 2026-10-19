import {
  ChallengeResponse,
  SUBSCRIPTIONS_MAX,
  LIMITS,
  newId,
  type AdminSubscription,
  type CreateSubscriptionRequest,
  type EventType,
  type OwnerSubscription,
  type RotatedSecret,
  type Subscription,
  type SubscriptionStatus,
} from '@logitland/contracts';
import { generateSecret, signHeaders } from '@logitland/webhooks';
import { iso, type Relay, type Stmt } from '../context';
import { randomToken } from '../crypto';
import { RelayError, conflict, notFound } from '../errors';
import type { AgentPrincipal } from '../types';
import { audit, auditStmt } from './audit';
import { usableChannel } from './channels';
import { DestinationRefused, checkUrl, preflightDestination } from './destinations';
import { recordGap } from './intake';
import { enforce } from './limits';

// Webhook subscriptions: an agent asks the relay to push channel events to an HTTPS endpoint. The
// destination is untrusted input (see destinations.ts), so creating one costs a rate-limit token, a DNS
// preflight and a signed challenge before any conversation data is sent.

export interface SubscriptionRow {
  id: string;
  agent_id: string;
  url_ciphertext: string;
  url_host: string;
  events: string;
  channel_ids: string;
  description: string | null;
  secret_ciphertext: string;
  secret_previous_ciphertext: string | null;
  secret_previous_until: string | null;
  status: SubscriptionStatus;
  paused_reason: string | null;
  paused_at: string | null;
  failure_streak: number;
  created_at: string;
}

export const urlAad = (subscriptionId: string) => `subscriptions.url:${subscriptionId}`;
export const secretAad = (subscriptionId: string) => `subscriptions.secret:${subscriptionId}`;
export const previousSecretAad = (subscriptionId: string) => `subscriptions.secret_previous:${subscriptionId}`;

/** A subscription its agent deleted stays as a disabled row (deliveries point at it) with this reason. */
const REMOVED = 'Removed by the agent';
const visible = (alias: string) => `(${alias}.status != 'disabled' OR COALESCE(${alias}.paused_reason, '') != '${REMOVED}')`;

const CREATES_PER_AGENT_PER_HOUR = 5;
const CREATES_PER_HOST_PER_HOUR = 10;
const CHALLENGE_MAX_BYTES = 4096;
const PREVIOUS_SECRET_HOURS = 24;

export const toSubscription = (r: SubscriptionRow): Subscription => ({
  id: r.id as Subscription['id'],
  agent_id: r.agent_id as Subscription['agent_id'],
  url_host: r.url_host,
  events: JSON.parse(r.events) as EventType[],
  channel_ids: JSON.parse(r.channel_ids) as string[],
  description: r.description,
  status: r.status,
  paused_reason: r.paused_reason,
  failure_streak: r.failure_streak,
  created_at: r.created_at,
});

/** Drops a subscription's undelivered deliveries, for use inside a batch with the change that stops them. */
export function dropPendingStmt(relay: Relay, subscriptionId: string, reason: string): Stmt {
  return relay.db
    .prepare("UPDATE deliveries SET status = 'dropped', next_attempt_at = NULL, last_error = ? WHERE subscription_id = ? AND status IN ('pending', 'retrying')")
    .bind(reason, subscriptionId);
}

/** At most `max` bytes of the body, read as a stream so a hostile endpoint can't make us buffer more. Null when it is larger. */
async function readCapped(res: Response, max: number): Promise<string | null> {
  if (!res.body) return '';
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let size = 0;
  let text = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) return text + decoder.decode();
    size += value.byteLength;
    if (size > max) {
      await reader.cancel();
      return null;
    }
    text += decoder.decode(value, { stream: true });
  }
}

/** POST a signed challenge; the receiver proves it controls the URL by echoing the token. Returns why it failed, or null. */
async function challenge(relay: Relay, subscriptionId: string, url: URL, secret: string): Promise<string | null> {
  const token = randomToken('chl_', 20);
  const body = JSON.stringify({ type: 'subscription.challenge', subscription_id: subscriptionId, challenge: token });
  try {
    const res = await relay.fetch(url, {
      method: 'POST',
      redirect: 'manual',
      headers: { 'content-type': 'application/json', 'user-agent': 'Logitland-Relay/0.1', ...(await signHeaders(secret, `chl_${subscriptionId}`, body, relay.now())) },
      body,
      signal: AbortSignal.timeout(LIMITS.deliveryTimeoutMs),
    });
    if (res.status < 200 || res.status >= 300) {
      await res.body?.cancel().catch(() => {});
      return `The destination answered the challenge with ${res.status}.${res.status >= 300 && res.status < 400 ? ' Redirects aren’t followed.' : ''}`;
    }
    const text = await readCapped(res, CHALLENGE_MAX_BYTES);
    if (text === null) return `The challenge response was larger than ${CHALLENGE_MAX_BYTES} bytes. Answer with just {"challenge": "<the challenge you were sent>"}.`;
    const answer = ChallengeResponse.safeParse(JSON.parse(text));
    return answer.success && answer.data.challenge === token ? null : 'The challenge response didn’t echo the challenge. Answer with {"challenge": "<the challenge you were sent>"}.';
  } catch (err) {
    if (err instanceof SyntaxError) return 'The challenge response wasn’t JSON. Answer with {"challenge": "<the challenge you were sent>"}.';
    return err instanceof Error && err.name === 'TimeoutError' ? `The destination didn’t answer the challenge within ${LIMITS.deliveryTimeoutMs / 1000} seconds.` : 'Couldn’t connect to the destination to send the challenge.';
  }
}

/** Destination problems are the caller's to fix: 422 with the reason. */
async function refusing<T>(work: () => T | Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (err) {
    if (err instanceof DestinationRefused) throw new RelayError(422, 'destination_refused', err.message);
    throw err;
  }
}

async function readableChannel(relay: Relay, channelId: string): Promise<void> {
  try {
    await usableChannel(relay, channelId, 'read');
  } catch (err) {
    if (err instanceof RelayError && err.status === 404) throw notFound(`Channel ${channelId} isn’t open to agents. List the open ones with GET /v1/channels.`);
    throw err;
  }
}

const capMessage = (max: number) => `Your agent can have ${max} subscriptions (active or paused). Delete one before adding another.`;

export async function createSubscription(relay: Relay, principal: AgentPrincipal, req: CreateSubscriptionRequest): Promise<Subscription & { secret: string }> {
  const agent = principal.agent;
  const channelIds = [...new Set(req.channel_ids)];
  const events = [...new Set(req.events)];
  for (const channelId of channelIds) await readableChannel(relay, channelId);

  const max = SUBSCRIPTIONS_MAX[agent.tier];
  const held = await relay.db.prepare("SELECT COUNT(*) AS n FROM subscriptions WHERE agent_id = ? AND status IN ('active', 'paused')").bind(agent.id).first<{ n: number }>();
  if ((held?.n ?? 0) >= max) throw conflict(capMessage(max));

  const host = (await refusing(() => checkUrl(req.url, relay.config.blockedHosts))).hostname;
  await enforce(relay, [{ key: `sub:create:${agent.id}:h`, limit: CREATES_PER_AGENT_PER_HOUR, windowSeconds: 3600 }], `Agents can add ${CREATES_PER_AGENT_PER_HOUR} subscriptions an hour. Try again later.`);
  await enforce(relay, [{ key: `sub:host:${host}:h`, limit: CREATES_PER_HOST_PER_HOUR, windowSeconds: 3600 }], 'Too many subscriptions were added for that destination recently. Try again later.');

  const url = await refusing(() => preflightDestination(req.url, relay.resolver, relay.config.blockedHosts));
  const now = relay.now();
  const id = newId('subscription', now.getTime());
  const secret = generateSecret();
  const failure = await challenge(relay, id, url, secret);
  if (failure) throw new RelayError(422, 'destination_refused', failure);

  const [urlCiphertext, secretCiphertext] = await Promise.all([relay.secrets.seal(url.toString(), urlAad(id)), relay.secrets.seal(secret, secretAad(id))]);
  // The cap is checked again inside the insert so concurrent creates can't overshoot it.
  const results = await relay.db.batch([
    relay.db
      .prepare(
        `INSERT INTO subscriptions (id, agent_id, url_ciphertext, url_host, events, channel_ids, description, secret_ciphertext, status, created_at)
         SELECT ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?
         WHERE (SELECT COUNT(*) FROM subscriptions WHERE agent_id = ? AND status IN ('active', 'paused')) < ?`,
      )
      .bind(id, agent.id, urlCiphertext, url.host, JSON.stringify(events), JSON.stringify(channelIds), req.description ?? null, secretCiphertext, iso(now), agent.id, max),
    ...channelIds.map((channelId) =>
      relay.db.prepare('INSERT INTO subscription_channels (subscription_id, channel_id) SELECT ?, ? WHERE EXISTS (SELECT 1 FROM subscriptions WHERE id = ?)').bind(id, channelId, id),
    ),
  ]);
  if (results[0]!.meta.changes !== 1) throw conflict(capMessage(max));
  await audit(relay, {
    actor_type: 'agent',
    actor_id: agent.id,
    action: 'subscription.created',
    target_type: 'subscription',
    target_id: id,
    diff: { url_host: { from: null, to: url.host }, channels: { from: null, to: channelIds.length }, events: { from: null, to: events } },
  });
  const row = (await relay.db.prepare('SELECT * FROM subscriptions WHERE id = ?').bind(id).first<SubscriptionRow>())!;
  return { ...toSubscription(row), secret };
}

export async function listSubscriptions(relay: Relay, agentId: string): Promise<Subscription[]> {
  const { results } = await relay.db.prepare(`SELECT * FROM subscriptions s WHERE s.agent_id = ? AND ${visible('s')} ORDER BY s.created_at, s.id`).bind(agentId).all<SubscriptionRow>();
  return results.map(toSubscription);
}

/** The agent's own subscription, or 404. Other agents' subscriptions look the same as missing ones. */
export async function ownSubscription(relay: Relay, agentId: string, id: string): Promise<SubscriptionRow> {
  const row = await relay.db.prepare(`SELECT * FROM subscriptions s WHERE s.id = ? AND s.agent_id = ? AND ${visible('s')}`).bind(id, agentId).first<SubscriptionRow>();
  if (!row) throw notFound('No such subscription');
  return row;
}

export async function deleteSubscription(relay: Relay, agentId: string, id: string): Promise<void> {
  await ownSubscription(relay, agentId, id);
  await relay.db.batch([
    relay.db.prepare("UPDATE subscriptions SET status = 'disabled', paused_reason = ?, secret_previous_ciphertext = NULL, secret_previous_until = NULL WHERE id = ?").bind(REMOVED, id),
    dropPendingStmt(relay, id, 'The subscription was removed'),
    relay.db.prepare('DELETE FROM subscription_channels WHERE subscription_id = ?').bind(id),
    auditStmt(relay, { actor_type: 'agent', actor_id: agentId, action: 'subscription.deleted', target_type: 'subscription', target_id: id }),
  ]);
}

/**
 * Paused → active, with the failure streak reset. Events that arrived while it was paused were never
 * fanned out to it, so a gap event over the whole outage tells the agent to catch up from /v1/events.
 */
export async function resumeSubscription(relay: Relay, agentId: string, id: string): Promise<Subscription> {
  const sub = await ownSubscription(relay, agentId, id);
  if (sub.status === 'disabled') throw conflict('This subscription was disabled and can’t be resumed. Create a new one.');
  if (sub.status === 'active') return toSubscription(sub);

  const now = relay.now();
  // The outage began at the first delivery that failed or was dropped since the last success, if that is earlier than the pause itself.
  const earliest = await relay.db
    .prepare(
      `SELECT MIN(created_at) AS t FROM deliveries
       WHERE subscription_id = ? AND status IN ('failed', 'dropped') AND created_at > COALESCE((SELECT MAX(delivered_at) FROM deliveries WHERE subscription_id = ? AND status = 'delivered'), '')`,
    )
    .bind(id, id)
    .first<{ t: string | null }>();
  const windowStart = [sub.paused_at, earliest?.t].filter((t): t is string => Boolean(t)).sort()[0] ?? iso(now);
  const { results: channels } = await relay.db
    .prepare("SELECT c.id FROM subscription_channels sc JOIN channels c ON c.id = sc.channel_id WHERE sc.subscription_id = ? AND c.agent_access != 'off'")
    .bind(id)
    .all<{ id: string }>();

  const resumed = await relay.db
    .prepare("UPDATE subscriptions SET status = 'active', failure_streak = 0, paused_reason = NULL, paused_at = NULL WHERE id = ? AND status = 'paused'")
    .bind(id)
    .run();
  if (resumed.meta.changes === 1) {
    await audit(relay, { actor_type: 'agent', actor_id: agentId, action: 'subscription.resumed', target_type: 'subscription', target_id: id, diff: { status: { from: 'paused', to: 'active' } } });
    if (channels.length) {
      try {
        await recordGap(relay, {
          channelIds: channels.map((c) => c.id),
          windowStart,
          windowEnd: iso(now),
          reason: 'Deliveries to a subscription were paused. Events in this window may not have been delivered; read them from GET /v1/events.',
        });
      } catch (error) {
        // The subscription is already active again; a failed gap record shouldn't undo that.
        relay.log.error('subscription.gap_failed', { subscription_id: id, error });
      }
    }
  }
  return toSubscription(await ownSubscription(relay, agentId, id));
}

/** New secret now; the previous one keeps signing alongside it for 24 hours so the receiver can switch without a gap. */
export async function rotateSecret(relay: Relay, agentId: string, id: string): Promise<RotatedSecret> {
  const sub = await ownSubscription(relay, agentId, id);
  if (sub.status === 'disabled') throw conflict('This subscription was disabled. Create a new one.');
  const now = relay.now();
  const until = iso(new Date(now.getTime() + PREVIOUS_SECRET_HOURS * 3_600_000));
  const secret = generateSecret();
  const [secretCiphertext, previousCiphertext] = await Promise.all([
    relay.secrets.seal(secret, secretAad(id)),
    relay.secrets.open(sub.secret_ciphertext, secretAad(id)).then((previous) => relay.secrets.seal(previous, previousSecretAad(id))),
  ]);
  const r = await relay.db
    .prepare('UPDATE subscriptions SET secret_ciphertext = ?, secret_previous_ciphertext = ?, secret_previous_until = ? WHERE id = ? AND secret_ciphertext = ?')
    .bind(secretCiphertext, previousCiphertext, until, id, sub.secret_ciphertext)
    .run();
  if (r.meta.changes !== 1) throw conflict('The secret was rotated at the same time. Try again.');
  await audit(relay, { actor_type: 'agent', actor_id: agentId, action: 'subscription.secret_rotated', target_type: 'subscription', target_id: id });
  return { secret, previous_valid_until: until };
}

/** Subscriptions of an owner's agents, newest first, with the agent's name. */
export async function listOwnerSubscriptions(relay: Relay, ownerId: string): Promise<OwnerSubscription[]> {
  const { results } = await relay.db
    .prepare(`SELECT s.*, a.name AS agent_name FROM subscriptions s JOIN agents a ON a.id = s.agent_id WHERE a.owner_id = ? AND ${visible('s')} ORDER BY s.id DESC`)
    .bind(ownerId)
    .all<SubscriptionRow & { agent_name: string }>();
  return results.map((r) => ({ ...toSubscription(r), agent_name: r.agent_name }));
}

/** Subscription health for admins, newest first. `next_before` is set when a full page came back. */
export async function listAdminSubscriptions(
  relay: Relay,
  opts: { status?: SubscriptionStatus; before?: string; limit: number },
): Promise<{ subscriptions: AdminSubscription[]; next_before: string | null }> {
  const where: string[] = [];
  const args: unknown[] = [];
  if (opts.status) {
    where.push('s.status = ?');
    args.push(opts.status);
  }
  if (opts.before) {
    where.push('s.id < ?');
    args.push(opts.before);
  }
  const { results } = await relay.db
    .prepare(
      `SELECT s.*, a.name AS agent_name,
         (SELECT MAX(d.delivered_at) FROM deliveries d WHERE d.subscription_id = s.id) AS last_delivered_at,
         (SELECT COUNT(*) FROM deliveries d WHERE d.subscription_id = s.id AND d.status IN ('pending', 'retrying')) AS pending_count
       FROM subscriptions s JOIN agents a ON a.id = s.agent_id
       ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY s.id DESC LIMIT ?`,
    )
    .bind(...args, opts.limit)
    .all<SubscriptionRow & { agent_name: string; last_delivered_at: string | null; pending_count: number }>();
  return {
    subscriptions: results.map((r) => ({ ...toSubscription(r), agent_name: r.agent_name, last_delivered_at: r.last_delivered_at, pending_count: r.pending_count })),
    next_before: results.length === opts.limit ? results[results.length - 1]!.id : null,
  };
}
