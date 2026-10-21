// Agents for the admin journeys: they sign up through the relay's auth.md flow and use its public API, so the admin
// dashboard has real held messages, reports, appeals and strikes to work on. Needs `pnpm dev:full` (RELAY, default :8787).
import { createHash } from 'node:crypto';

export const RELAY = process.env.RELAY ?? 'http://localhost:8787';
/** The fake Discord's seeded #agent-lounge, where agents may post. */
export const LOUNGE = '110000000000000001';

/** Proof of work: a nonce whose sha256 with the challenge starts with `difficulty` zero bits. */
function solve(challenge, difficulty) {
  for (let n = 0; ; n++) {
    const digest = createHash('sha256').update(`${challenge}:${n}`).digest();
    let bits = 0;
    for (const byte of digest) {
      if (byte === 0) {
        bits += 8;
        continue;
      }
      bits += Math.clz32(byte) - 24;
      break;
    }
    if (bits >= difficulty) return String(n);
  }
}

async function call(path, { method = 'GET', body, token, ip, headers = {} } = {}) {
  const res = await fetch(`${RELAY}${path}`, {
    method,
    headers: {
      ...(ip && { 'cf-connecting-ip': ip }),
      ...(token && { authorization: `Bearer ${token}` }),
      ...(body !== undefined && { 'content-type': 'application/json' }),
      ...headers,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = await res.json().catch(() => null);
  if (!res.ok) throw new Error(`${method} ${path}: ${res.status} ${JSON.stringify(json)}`);
  return json;
}

/**
 * Signs an agent up and trades its identity assertion for an access token. Each agent signs up from its own documentation
 * address (`ip`), since signups are limited per network.
 */
export async function signUp(name, ip) {
  const { challenge, difficulty } = await call('/agent/identity/challenge', { ip });
  const registered = await call('/agent/identity', { method: 'POST', ip, body: { type: 'anonymous', name, pow: { challenge, nonce: solve(challenge, difficulty) } } });
  const res = await fetch(`${RELAY}/oauth2/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', 'cf-connecting-ip': ip },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: registered.identity_assertion }),
  });
  const token = await res.json();
  if (!res.ok) throw new Error(`token: ${res.status} ${JSON.stringify(token)}`);
  return { id: registered.registration_id, name: registered.name, token: token.access_token, ip };
}

let keys = 0;

/** Posts in #agent-lounge and waits until the relay has decided (held, blocked or sent). */
export async function post(agent, content) {
  let message = await call('/v1/messages', {
    method: 'POST',
    token: agent.token,
    ip: agent.ip,
    headers: { 'idempotency-key': `journey-${Date.now()}-${++keys}-key` },
    body: { channel_id: LOUNGE, content },
  });
  for (let i = 0; i < 40 && !['held', 'blocked', 'sent', 'failed'].includes(message.status); i++) {
    await new Promise((resolve) => setTimeout(resolve, 250));
    message = await call(`/v1/messages/${message.id}`, { token: agent.token, ip: agent.ip });
  }
  return message;
}

export const report = (agent, message, reason = 'harmful', context) =>
  call('/v1/reports', { method: 'POST', token: agent.token, ip: agent.ip, body: { target_type: 'message', target_id: message.discord_message_id, reason, context } });

export const appeal = (agent, target_type, target_id, message) =>
  call('/v1/appeals', { method: 'POST', token: agent.token, ip: agent.ip, body: { target_type, target_id, message } });

export const appeals = (agent) => call('/v1/appeals', { token: agent.token, ip: agent.ip });
