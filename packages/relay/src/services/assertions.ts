import { newId } from '@logitland/contracts';
import type { Relay } from '../context';

// Identity assertions (auth.md v0.6.0): the long-lived, relay-signed JWT an agent gets at registration and trades for access
// tokens at /oauth2/token. The relay is both issuer and audience, so it signs with HMAC (HS256), keyed from RELAY_SECRET_KEY
// (crypto.ts), and old keys in RELAY_SECRET_KEYS_OLD still verify: rotating the secret doesn't cost an agent its identity.
// "Renews when used" (#7, #30): every exchange hands back a fresh assertion with a new expiry, so an agent in use keeps its
// identity, level and XP for good; one unused for ASSERTION_DAYS has to register again.

export const ASSERTION_DAYS = 90;
const TYP = 'oauth-id-jag+jwt';

export interface AssertionClaims {
  iss: string;
  aud: string;
  /** The agent's ID, which is also its auth.md registration_id. */
  sub: string;
  iat: number;
  exp: number;
  jti: string;
}

const enc = new TextEncoder();
const b64url = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
const fromB64url = (s: string): Uint8Array<ArrayBuffer> => {
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4));
  const out = new Uint8Array(new ArrayBuffer(bin.length));
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
};
const json = (v: unknown) => b64url(enc.encode(JSON.stringify(v)));

/** A fresh assertion for an agent and when it expires. */
export async function issueAssertion(relay: Relay, agentId: string): Promise<{ assertion: string; expires: string }> {
  const now = Math.floor(relay.now().getTime() / 1000);
  const claims: AssertionClaims = {
    iss: relay.config.publicUrl,
    aud: relay.config.publicUrl,
    sub: agentId,
    iat: now,
    exp: now + ASSERTION_DAYS * 86_400,
    jti: newId('event').slice(4),
  };
  const kid = relay.secrets.currentId;
  const body = `${json({ alg: 'HS256', typ: TYP, kid })}.${json(claims)}`;
  const signature = await relay.secrets.sign(kid, body);
  return { assertion: `${body}.${b64url(signature)}`, expires: new Date(claims.exp * 1000).toISOString() };
}

/** The agent an assertion names, or null when it isn't one of ours, was tampered with, or has expired. */
export async function verifyAssertion(relay: Relay, assertion: string): Promise<string | null> {
  const [head, payload, sig, extra] = assertion.split('.');
  if (!head || !payload || !sig || extra !== undefined) return null;
  try {
    const header = JSON.parse(new TextDecoder().decode(fromB64url(head))) as { alg?: string; typ?: string; kid?: string };
    if (header.alg !== 'HS256' || header.typ !== TYP || !header.kid) return null;
    if (!(await relay.secrets.verify(header.kid, `${head}.${payload}`, fromB64url(sig)))) return null;
    const claims = JSON.parse(new TextDecoder().decode(fromB64url(payload))) as Partial<AssertionClaims>;
    const now = Math.floor(relay.now().getTime() / 1000);
    if (claims.iss !== relay.config.publicUrl || claims.aud !== relay.config.publicUrl || typeof claims.sub !== 'string') return null;
    if (typeof claims.exp !== 'number' || claims.exp <= now) return null;
    return claims.sub;
  } catch {
    return null;
  }
}
