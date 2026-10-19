// A small signed cookie (HMAC-SHA256) for the dashboard session. Discord tokens are never stored:
// the dashboard keeps only who signed in (auth.md research proposal).

import type { Cookies } from '@sveltejs/kit';

export interface Session {
  owner_id: string;
  discord_user_id: string;
  username: string;
  is_admin: boolean;
  /** Unix seconds. */
  exp: number;
}

const encoder = new TextEncoder();
const COOKIE = 'll_session';
const MAX_AGE = 60 * 60 * 24 * 7;
const PERSON_COOKIE = 'll_person';
const PERSON_MAX_AGE = 60 * 30;

const b64url = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
const fromB64url = (s: string) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));

async function key(secret: string) {
  return crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}

/** What a signed value is for. It is part of what is signed, so a value made for one cookie is never accepted as another. */
export type Purpose = 'session' | 'person' | 'oauth';

export async function sign(secret: string, purpose: Purpose, value: unknown): Promise<string> {
  const body = b64url(encoder.encode(JSON.stringify(value)));
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', await key(secret), encoder.encode(`${purpose}.${body}`)));
  return `${body}.${b64url(mac)}`;
}

export async function unsign<T>(secret: string, purpose: Purpose, token: string | undefined): Promise<T | null> {
  if (!token) return null;
  const [body, mac] = token.split('.');
  if (!body || !mac) return null;
  try {
    const ok = await crypto.subtle.verify('HMAC', await key(secret), fromB64url(mac), encoder.encode(`${purpose}.${body}`));
    return ok ? (JSON.parse(new TextDecoder().decode(fromB64url(body))) as T) : null;
  } catch {
    return null;
  }
}

export async function readSession(cookies: Cookies, secret: string): Promise<Session | null> {
  const s = await unsign<Session>(secret, 'session', cookies.get(COOKIE));
  return s && typeof s.owner_id === 'string' && s.exp > Date.now() / 1000 ? s : null;
}

export async function writeSession(cookies: Cookies, secret: string, s: Omit<Session, 'exp'>, secure: boolean): Promise<void> {
  const value = await sign(secret, 'session', { ...s, exp: Math.floor(Date.now() / 1000) + MAX_AGE });
  cookies.set(COOKIE, value, { path: '/', httpOnly: true, sameSite: 'lax', secure, maxAge: MAX_AGE });
}

export function clearSession(cookies: Cookies): void {
  cookies.delete(COOKIE, { path: '/' });
  cookies.delete(PERSON_COOKIE, { path: '/' });
}

/**
 * Someone who signed in with Discord only to see or remove their own mirrored messages. No owner account exists for them and
 * none is made: all the relay is told is their Discord ID. The cookie is short-lived and only the removal page reads it.
 */
export interface PersonSession {
  kind: 'person';
  discord_user_id: string;
  username: string;
  /** Unix seconds. */
  exp: number;
}

export async function readPerson(cookies: Cookies, secret: string): Promise<PersonSession | null> {
  const s = await unsign<PersonSession>(secret, 'person', cookies.get(PERSON_COOKIE));
  return s && s.kind === 'person' && s.exp > Date.now() / 1000 ? s : null;
}

export async function writePerson(cookies: Cookies, secret: string, p: Pick<PersonSession, 'discord_user_id' | 'username'>, secure: boolean): Promise<void> {
  const value = await sign(secret, 'person', { kind: 'person', ...p, exp: Math.floor(Date.now() / 1000) + PERSON_MAX_AGE });
  cookies.set(PERSON_COOKIE, value, { path: '/', httpOnly: true, sameSite: 'lax', secure, maxAge: PERSON_MAX_AGE });
}

/** Signing in from the message-removal page needs no owner account; every other page does. */
export const isRemovalOnly = (next: string): boolean => /^\/mirror\/remove(?:[/?#]|$)/.test(next);
