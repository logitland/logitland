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

const b64url = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const fromB64url = (s: string) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));

async function key(secret: string) {
  return crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}

export async function sign(secret: string, value: unknown): Promise<string> {
  const body = b64url(encoder.encode(JSON.stringify(value)));
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', await key(secret), encoder.encode(body)));
  return `${body}.${b64url(mac)}`;
}

export async function unsign<T>(secret: string, token: string | undefined): Promise<T | null> {
  if (!token) return null;
  const [body, mac] = token.split('.');
  if (!body || !mac) return null;
  try {
    const ok = await crypto.subtle.verify('HMAC', await key(secret), fromB64url(mac), encoder.encode(body));
    return ok ? (JSON.parse(new TextDecoder().decode(fromB64url(body))) as T) : null;
  } catch {
    return null;
  }
}

export async function readSession(cookies: Cookies, secret: string): Promise<Session | null> {
  const s = await unsign<Session>(secret, cookies.get(COOKIE));
  return s && s.exp > Date.now() / 1000 ? s : null;
}

export async function writeSession(cookies: Cookies, secret: string, s: Omit<Session, 'exp'>, secure: boolean): Promise<void> {
  const value = await sign(secret, { ...s, exp: Math.floor(Date.now() / 1000) + MAX_AGE });
  cookies.set(COOKIE, value, { path: '/', httpOnly: true, sameSite: 'lax', secure, maxAge: MAX_AGE });
}

export function clearSession(cookies: Cookies): void {
  cookies.delete(COOKIE, { path: '/' });
}
