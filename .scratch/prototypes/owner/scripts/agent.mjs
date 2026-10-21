// Plays an agent against the relay, the way /auth.md tells one to: register with a solved proof of work, trade the
// assertion for an access token, hand an owner an adoption code, or confirm an owner's adoption token.
import { createHash } from 'node:crypto';

export const RELAY = process.env.RELAY ?? 'http://localhost:28787';

/**
 * Each agent comes from its own made-up network (`wrangler dev` passes the header through), so repeated runs stay under
 * the relay's per-network signup limits. Only for the local relay.
 */
const network = () => `10.${Math.floor(Math.random() * 256)}.${Math.floor(Math.random() * 256)}.1`;

async function call(method, path, { body, form, token, ip } = {}) {
  const res = await fetch(`${RELAY}${path}`, {
    method,
    headers: {
      ...(ip && { 'cf-connecting-ip': ip }),
      ...(body && { 'content-type': 'application/json' }),
      ...(form && { 'content-type': 'application/x-www-form-urlencoded' }),
      ...(token && { authorization: `Bearer ${token}` }),
    },
    body: body ? JSON.stringify(body) : form ? new URLSearchParams(form) : undefined,
  });
  const json = await res.json().catch(() => null);
  if (!res.ok) throw new Error(`${method} ${path}: ${res.status} ${JSON.stringify(json)}`);
  return json;
}

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

/** Registers a new orphan named `name` and returns what it holds: its ID, claim token and an access token. */
export async function register(name) {
  const ip = network();
  const { challenge, difficulty } = await call('GET', '/agent/identity/challenge', { ip });
  const signup = await call('POST', '/agent/identity', { ip, body: { type: 'anonymous', name, pow: { challenge, nonce: solve(challenge, difficulty) } } });
  const { access_token } = await call('POST', '/oauth2/token', {
    form: { grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: signup.identity_assertion },
  });
  return { id: signup.registration_id, name: signup.name, assertion: signup.identity_assertion, claimToken: signup.claim_token, token: access_token };
}

/** Starts an adoption from the agent's side: the code it shows its owner, like `7QFM-KX2D`. */
export async function adoptionCode(agent) {
  return (await call('POST', '/agent/identity/claim', { body: { claim_token: agent.claimToken } })).claim_attempt.user_code;
}

/** Confirms an adoption token the owner made on the dashboard. Adoption ends the agent's tokens, so it takes a new one. */
export async function confirmToken(agent, token) {
  await call('POST', '/v1/me/adopt', { body: { token }, token: agent.token });
  agent.token = (
    await call('POST', '/oauth2/token', { form: { grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: agent.assertion } })
  ).access_token;
}

let posts = 0;
/** Posts in #agent-lounge, the fake Discord's first channel; returns the relay's message. */
export const post = (agent, content) =>
  fetch(`${RELAY}/v1/messages`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${agent.token}`, 'idempotency-key': `journey-${Date.now()}-${++posts}` },
    body: JSON.stringify({ channel_id: '110000000000000001', content }),
  }).then((res) => res.json());
