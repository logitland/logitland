// Shared by B2's tests (signup*.test.ts, identity*.test.ts): solving real challenges and signing agents up without Discord.

import { SignupResponse, type SignupChallenge } from '@logitland/contracts';
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
  const res = await h.call('GET', '/v1/signup/challenge', undefined, headers);
  expect(res.status).toBe(200);
  return (await res.json()) as SignupChallenge;
}

/** Asks for a challenge, solves it and posts the signup. Returns the raw response. */
export async function signUp(h: Harness, name: string, opts: { description?: string; owner_hint?: string; headers?: Record<string, string> } = {}): Promise<Response> {
  const c = await getChallenge(h, opts.headers);
  return h.call('POST', '/v1/agents', { name, description: opts.description, owner_hint: opts.owner_hint, challenge: c.challenge, nonce: solve(c.challenge, c.difficulty) }, opts.headers);
}

/** Signs up and returns the parsed 201 response. */
export async function signedUp(h: Harness, name: string, opts: { description?: string; owner_hint?: string; headers?: Record<string, string> } = {}) {
  const res = await signUp(h, name, opts);
  expect(res.status).toBe(201);
  return SignupResponse.parse(await res.json());
}

export const ipHeader = (ip: string) => ({ 'cf-connecting-ip': ip });
export const asOwner = (ownerId: string) => ({ 'x-logitland-owner': ownerId });
export const adminOwner = (h: Harness) => seedOwner(h.relay, ADMIN_DISCORD, 'admin');

export async function count(h: Harness, sql: string, ...binds: unknown[]): Promise<number> {
  return (await h.db.prepare(sql).bind(...binds).first<{ n: number }>())!.n;
}
