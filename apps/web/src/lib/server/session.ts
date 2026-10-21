import type { Owner } from '@logitland/contracts';
import { error, type Cookies } from '@sveltejs/kit';
import { env } from 'cloudflare:workers';

/**
 * The signed-in owner, kept in a cookie signed with `SESSION_SECRET` (HMAC-SHA-256). The relay holds everything else, so
 * the cookie carries only who it is; admin standing is asked of the relay each time a dashboard loads.
 */
export type SignedIn = Pick<Owner, 'id' | 'username'>;

export const SESSION_COOKIE = 'session';
const MAX_AGE_SECONDS = 30 * 86_400;

const bytes = (text: string) => new TextEncoder().encode(text);
const encode = (data: Uint8Array) =>
  btoa(String.fromCharCode(...data))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
const decode = (text: string) => Uint8Array.from(atob(text.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));
const key = (secret: string) => crypto.subtle.importKey('raw', bytes(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);

/**
 * How the sign-in cookies are set. Secure only over https: SvelteKit makes cookies secure everywhere but `localhost`, and a
 * browser drops secure cookies over plain http, so a dev server reached at its network address could never sign in.
 */
export const cookieOptions = (url: URL) => ({ httpOnly: true, sameSite: 'lax', secure: url.protocol === 'https:' }) as const;

export async function writeSession(cookies: Cookies, url: URL, owner: SignedIn): Promise<void> {
  if (!env.SESSION_SECRET) error(503, 'Sign-in isn’t set up');
  const payload = encode(bytes(JSON.stringify({ id: owner.id, username: owner.username, exp: Date.now() + MAX_AGE_SECONDS * 1000 })));
  const signature = encode(new Uint8Array(await crypto.subtle.sign('HMAC', await key(env.SESSION_SECRET), bytes(payload))));
  cookies.set(SESSION_COOKIE, `${payload}.${signature}`, { ...cookieOptions(url), path: '/', maxAge: MAX_AGE_SECONDS });
}

/** The owner the cookie names, if this app signed it and it hasn't expired. */
export async function readSession(cookies: Cookies): Promise<SignedIn | undefined> {
  const [payload, signature] = cookies.get(SESSION_COOKIE)?.split('.') ?? [];
  if (!env.SESSION_SECRET || !payload || !signature) return undefined;
  try {
    if (!(await crypto.subtle.verify('HMAC', await key(env.SESSION_SECRET), decode(signature), bytes(payload)))) return undefined;
    const { id, username, exp } = JSON.parse(new TextDecoder().decode(decode(payload))) as SignedIn & { exp: number };
    return exp > Date.now() ? { id, username } : undefined;
  } catch {
    // Not base64url: not a cookie this app wrote.
    return undefined;
  }
}

export const endSession = (cookies: Cookies, url: URL) => cookies.delete(SESSION_COOKIE, { ...cookieOptions(url), path: '/' });
