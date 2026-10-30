import { ChallengeResponse, LIMITS, type CreatedDelivery, type DeliverySetting, type RotatedSecret, type WebhookStatus } from '@logitland/contracts';
import { generateSecret, signHeaders } from '@logitland/webhooks';
import { iso, type Relay } from '../context';
import { randomToken } from '../crypto';
import { RelayError, conflict, notFound, unavailable } from '../errors';
import { audit, auditStmt } from './audit';
import { DestinationRefused, checkUrl, preflightDestination } from './destinations';
import { enforce } from './limits';
import { getSettings } from './settings';

// An agent's one webhook (#11): where the relay POSTs its digests. The destination is untrusted input (destinations.ts),
// so setting one costs a rate-limit token, a DNS preflight and a signed challenge before any conversation data is sent.
// Without a webhook an agent reads with GET /v1/events or a WebSocket.

export interface WebhookRow {
  agent_id: string;
  url_ciphertext: string;
  url_host: string;
  secret_ciphertext: string;
  secret_previous_ciphertext: string | null;
  secret_previous_until: string | null;
  status: WebhookStatus;
  paused_reason: string | null;
  paused_at: string | null;
  failure_streak: number;
  failing_since: string | null;
  created_at: string;
  updated_at: string;
}

// Sealed values are bound to their agent and column (reseal.ts re-seals them under a new key the same way).
export const urlAad = (w: Pick<WebhookRow, 'agent_id'>) => `webhook.url:${w.agent_id}`;
export const secretAad = (w: Pick<WebhookRow, 'agent_id'>) => `webhook.secret:${w.agent_id}`;
export const previousSecretAad = (w: Pick<WebhookRow, 'agent_id'>) => `webhook.secret_previous:${w.agent_id}`;

const SETS_PER_AGENT_PER_HOUR = 5;
const SETS_PER_HOST_PER_HOUR = 10;
const RESUMES_PER_AGENT_PER_DAY = 6;
const CHALLENGE_MAX_BYTES = 4096;
const PREVIOUS_SECRET_HOURS = 24;

export const toDeliverySetting = (w: WebhookRow | null): DeliverySetting =>
  w
    ? { kind: 'webhook', url_host: w.url_host, status: w.status, paused_reason: w.paused_reason, failure_streak: w.failure_streak, created_at: w.created_at }
    : { kind: 'none' };

/** getWebhook as a statement, to read in one round trip with others. */
export const webhookStmt = (relay: Relay, agentId: string) => relay.db.prepare('SELECT * FROM agent_webhooks WHERE agent_id = ?').bind(agentId);

export async function getWebhook(relay: Relay, agentId: string): Promise<WebhookRow | null> {
  return webhookStmt(relay, agentId).first<WebhookRow>();
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
async function challenge(relay: Relay, agentId: string, url: URL, secret: string): Promise<string | null> {
  const token = randomToken('chl_', 20);
  const body = JSON.stringify({ type: 'delivery.challenge', agent_id: agentId, challenge: token });
  try {
    const res = await relay.fetch(url, {
      method: 'POST',
      redirect: 'manual',
      headers: { 'content-type': 'application/json', 'user-agent': 'Logitland-Relay/0.1', ...(await signHeaders(secret, `chl_${agentId}`, body, relay.now())) },
      body,
      signal: AbortSignal.timeout(LIMITS.deliveryTimeoutMs),
    });
    if (res.status < 200 || res.status >= 300) {
      await res.body?.cancel().catch(() => {});
      return `The destination answered the challenge with ${res.status}.${res.status >= 300 && res.status < 400 ? ' Redirects aren’t followed.' : ''}`;
    }
    const text = await readCapped(res, CHALLENGE_MAX_BYTES);
    if (text === null)
      return `The challenge response was larger than ${CHALLENGE_MAX_BYTES} bytes. Answer with just {"challenge": "<the challenge you were sent>"}.`;
    const answer = ChallengeResponse.safeParse(JSON.parse(text));
    return answer.success && answer.data.challenge === token
      ? null
      : 'The challenge response didn’t echo the challenge. Answer with {"challenge": "<the challenge you were sent>"}.';
  } catch (err) {
    if (err instanceof SyntaxError) return 'The challenge response wasn’t JSON. Answer with {"challenge": "<the challenge you were sent>"}.';
    return err instanceof Error && err.name === 'TimeoutError'
      ? `The destination didn’t answer the challenge within ${LIMITS.deliveryTimeoutMs / 1000} seconds.`
      : 'Couldn’t connect to the destination to send the challenge.';
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

/**
 * Sets (or replaces) the agent's webhook after it answers the challenge, and returns the signing secret once. Digests
 * already waiting go to the new one; deliveries still retrying to the old one are dropped.
 */
export async function setWebhook(relay: Relay, agentId: string, rawUrl: string): Promise<CreatedDelivery> {
  // Setting one contacts the destination, which a switched-off delivery path should not do.
  if ((await getSettings(relay)).deliveries_paused)
    throw unavailable('Deliveries are switched off by an admin at the moment, so a webhook can’t be set. Try again later.', 300);
  const host = (await refusing(() => checkUrl(rawUrl, relay.config.blockedHosts))).hostname;
  await enforce(
    relay,
    [{ key: `webhook:set:${agentId}:h`, limit: SETS_PER_AGENT_PER_HOUR, windowSeconds: 3600 }],
    `You can set your webhook ${SETS_PER_AGENT_PER_HOUR} times an hour. Try again later.`,
  );
  await enforce(
    relay,
    [{ key: `webhook:host:${host}:h`, limit: SETS_PER_HOST_PER_HOUR, windowSeconds: 3600 }],
    'Too many webhooks were set for that destination recently. Try again later.',
  );
  const url = await refusing(() => preflightDestination(rawUrl, relay.resolver, relay.config.blockedHosts));
  const secret = generateSecret();
  const failure = await challenge(relay, agentId, url, secret);
  if (failure) throw new RelayError(422, 'destination_refused', failure);

  const now = iso(relay.now());
  const row = { agent_id: agentId, created_at: now };
  const [urlCiphertext, secretCiphertext] = await Promise.all([relay.secrets.seal(url.toString(), urlAad(row)), relay.secrets.seal(secret, secretAad(row))]);
  await relay.db.batch([
    relay.db
      .prepare(
        `INSERT INTO agent_webhooks (agent_id, url_ciphertext, url_host, secret_ciphertext, status, created_at, updated_at) VALUES (?, ?, ?, ?, 'active', ?, ?)
         ON CONFLICT (agent_id) DO UPDATE SET url_ciphertext = excluded.url_ciphertext, url_host = excluded.url_host, secret_ciphertext = excluded.secret_ciphertext,
           secret_previous_ciphertext = NULL, secret_previous_until = NULL, status = 'active', paused_reason = NULL, paused_at = NULL, failure_streak = 0,
           failing_since = NULL, created_at = excluded.created_at, updated_at = excluded.updated_at`,
      )
      .bind(agentId, urlCiphertext, url.host, secretCiphertext, now, now),
    dropOpenStmt(relay, agentId, 'The webhook was replaced'),
    auditStmt(relay, {
      actor_type: 'agent',
      actor_id: agentId,
      action: 'webhook.set',
      target_type: 'agent',
      target_id: agentId,
      diff: { url_host: { from: null, to: url.host } },
    }),
  ]);
  return { delivery: toDeliverySetting(await getWebhook(relay, agentId)), secret };
}

/** Deliveries not yet through, dropped (in a batch with the change that stops them). */
export const dropOpenStmt = (relay: Relay, agentId: string, reason: string) =>
  relay.db
    .prepare("UPDATE deliveries SET status = 'dropped', next_attempt_at = NULL, last_error = ? WHERE agent_id = ? AND status IN ('pending', 'retrying')")
    .bind(reason, agentId);

/** Stops webhook delivery. Subscriptions stay; their digests wait for GET /v1/events or a WebSocket. */
export async function removeWebhook(
  relay: Relay,
  agentId: string,
  actor: { type: 'agent' | 'owner' | 'admin'; id: string } = { type: 'agent', id: agentId },
): Promise<void> {
  await relay.db.batch([
    relay.db.prepare('DELETE FROM agent_webhooks WHERE agent_id = ?').bind(agentId),
    dropOpenStmt(relay, agentId, 'The webhook was removed'),
    auditStmt(relay, { actor_type: actor.type, actor_id: actor.id, action: 'webhook.removed', target_type: 'agent', target_id: agentId }),
  ]);
}

async function ownWebhook(relay: Relay, agentId: string): Promise<WebhookRow> {
  const row = await getWebhook(relay, agentId);
  if (!row) throw notFound('You have no webhook. Set one with PUT /v1/delivery.');
  return row;
}

/** Paused → active, with the failure streak reset. What waited while it was paused goes out next. Limited per day. */
export async function resumeWebhook(relay: Relay, agentId: string): Promise<DeliverySetting> {
  const row = await ownWebhook(relay, agentId);
  if (row.status === 'disabled') throw conflict('The webhook was disabled (it answered 410). Set it again with PUT /v1/delivery.');
  if (row.status === 'active') return toDeliverySetting(row);
  await enforce(
    relay,
    [{ key: `webhook:resume:${agentId}:d`, limit: RESUMES_PER_AGENT_PER_DAY, windowSeconds: 86_400 }],
    'Your webhook has been resumed several times today and keeps stopping. Fix it, then try again tomorrow, or read GET /v1/events meanwhile.',
  );
  const resumed = await relay.db
    .prepare(
      "UPDATE agent_webhooks SET status = 'active', failure_streak = 0, failing_since = NULL, paused_reason = NULL, paused_at = NULL, updated_at = ? WHERE agent_id = ? AND status = 'paused'",
    )
    .bind(iso(relay.now()), agentId)
    .run();
  if (resumed.meta.changes > 0)
    await audit(relay, { actor_type: 'agent', actor_id: agentId, action: 'webhook.resumed', target_type: 'agent', target_id: agentId });
  return toDeliverySetting(await getWebhook(relay, agentId));
}

/** New secret now; the previous one keeps signing alongside it for 24 hours so the receiver can switch without a gap. */
export async function rotateWebhookSecret(relay: Relay, agentId: string): Promise<RotatedSecret> {
  const row = await ownWebhook(relay, agentId);
  const until = iso(new Date(relay.now().getTime() + PREVIOUS_SECRET_HOURS * 3_600_000));
  const secret = generateSecret();
  const [secretCiphertext, previousCiphertext] = await Promise.all([
    relay.secrets.seal(secret, secretAad(row)),
    relay.secrets.open(row.secret_ciphertext, secretAad(row)).then((previous) => relay.secrets.seal(previous, previousSecretAad(row))),
  ]);
  const r = await relay.db
    .prepare(
      'UPDATE agent_webhooks SET secret_ciphertext = ?, secret_previous_ciphertext = ?, secret_previous_until = ?, updated_at = ? WHERE agent_id = ? AND secret_ciphertext = ?',
    )
    .bind(secretCiphertext, previousCiphertext, until, iso(relay.now()), agentId, row.secret_ciphertext)
    .run();
  if (r.meta.changes === 0) throw conflict('The secret was rotated at the same time. Try again.');
  await audit(relay, { actor_type: 'agent', actor_id: agentId, action: 'webhook.secret_rotated', target_type: 'agent', target_id: agentId });
  return { secret, previous_valid_until: until };
}
