// Shared by the signup and identity tests (signup*.test.ts, identity*.test.ts, auth*.test.ts): solving real challenges and
// registering agents the auth.md way.

import { RegistrationResponse, TokenResponse, type SignupChallenge } from '@logitland/contracts';
import { createHash } from 'node:crypto';
import { expect } from 'vitest';
import { updateSettings } from './services/settings';
import { ADMIN_DISCORD, seedOwner, type Harness } from './testing';

function zeroBits(digest: Buffer): number {
  let bits = 0;
  for (const byte of digest) {
    if (byte === 0) {
      bits += 8;
      continue;
    }
    return bits + Math.clz32(byte) - 24;
  }
  return bits;
}

/** Finds a nonce for real, the way an agent would. */
export function solve(challenge: string, difficulty: number): string {
  for (let n = 0; ; n++) {
    if (zeroBits(createHash('sha256').update(`${challenge}:${n}`).digest()) >= difficulty) return String(n);
  }
}

/** The smallest difficulty the settings allow, so tests solve in a few hundred hashes. */
export async function easyChallenges(h: Harness): Promise<void> {
  await updateSettings(h.relay, 'own_test_setup', { pow_difficulty: 8 });
}

export async function getChallenge(h: Harness, headers: Record<string, string> = {}): Promise<SignupChallenge> {
  const res = await h.call('GET', '/agent/identity/challenge', undefined, headers);
  expect(res.status).toBe(200);
  return (await res.json()) as SignupChallenge;
}

/** Asks for a challenge, solves it and registers (auth.md Step 3). No name gets a generated one. Returns the raw response. */
export async function signUp(h: Harness, name?: string, opts: { headers?: Record<string, string> } = {}): Promise<Response> {
  const c = await getChallenge(h, opts.headers);
  return h.call('POST', '/agent/identity', { type: 'anonymous', name, pow: { challenge: c.challenge, nonce: solve(c.challenge, c.difficulty) } }, opts.headers);
}

/** Registers and returns the parsed response. */
export async function signedUp(h: Harness, name?: string, opts: { headers?: Record<string, string> } = {}) {
  const res = await signUp(h, name, opts);
  expect(res.status).toBe(200);
  return RegistrationResponse.parse(await res.json());
}

/** POST /oauth2/token, form-encoded as auth.md shows. */
export const tokenCall = (h: Harness, fields: Record<string, string>) => h.form('/oauth2/token', fields);

/** Registers and exchanges the assertion: an agent with a working access token, the way a real one gets it. */
export async function registered(h: Harness, name?: string, opts: { headers?: Record<string, string> } = {}) {
  const reg = await signedUp(h, name, opts);
  const res = await tokenCall(h, { grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: reg.identity_assertion });
  expect(res.status).toBe(200);
  const token = TokenResponse.parse(await res.json());
  return { reg, token, auth: h.as(token.access_token) };
}

export const ipHeader = (ip: string) => ({ 'cf-connecting-ip': ip });
export const asOwner = (ownerId: string) => ({ 'x-logitland-owner': ownerId });
export const adminOwner = (h: Harness) => seedOwner(h.relay, ADMIN_DISCORD, 'admin');

export async function count(h: Harness, sql: string, ...binds: unknown[]): Promise<number> {
  return (await h.db
    .prepare(sql)
    .bind(...binds)
    .first<{ n: number }>())!.n;
}

let seeded = 0;

/** A subscription row for an agent, without going through the subscription endpoints. */
export async function seedSubscription(h: Harness, agentId: string, status: 'active' | 'paused' | 'disabled' = 'active'): Promise<string> {
  const id = `sub_${String(++seeded).padStart(10, '0')}`;
  await h.db
    .prepare(
      "INSERT INTO subscriptions (id, agent_id, url_ciphertext, url_host, events, channel_ids, secret_ciphertext, status, created_at) VALUES (?, ?, 'x', 'hooks.orrery.dev', '[]', '[]', 'x', ?, ?)",
    )
    .bind(id, agentId, status, h.now().toISOString())
    .run();
  return id;
}

/** A delivery to a subscription, with the event it belongs to. */
export async function seedDelivery(h: Harness, subscriptionId: string, status: 'pending' | 'retrying' | 'delivered' | 'failed' | 'dropped'): Promise<string> {
  const n = String(++seeded).padStart(10, '0');
  await h.db
    .prepare(
      "INSERT INTO events (id, source_key, type, guild_id, channel_id, payload, observed_at) VALUES (?, ?, 'message.created', '100000000000000001', '110000000000000001', '{}', ?)",
    )
    .bind(`evt_${n}`, `source-${n}`, h.now().toISOString())
    .run();
  await h.db
    .prepare(
      "INSERT INTO deliveries (id, subscription_id, event_id, event_type, status, next_attempt_at, created_at) VALUES (?, ?, ?, 'message.created', ?, ?, ?)",
    )
    .bind(`del_${n}`, subscriptionId, `evt_${n}`, status, status === 'pending' || status === 'retrying' ? h.now().toISOString() : null, h.now().toISOString())
    .run();
  return `del_${n}`;
}
