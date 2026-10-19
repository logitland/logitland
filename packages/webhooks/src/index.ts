// Standard Webhooks v1 (symmetric HMAC-SHA256), implemented with WebCrypto so it runs unchanged in
// Workers, Node and browsers. Spec: https://github.com/standard-webhooks/standard-webhooks/blob/main/spec/standard-webhooks.md
// Signed content is `${id}.${timestamp}.${body}`; the signature header is a space-separated list of `v1,<base64>`.

const SECRET_PREFIX = 'whsec_';
const encoder = new TextEncoder();

export class WebhookVerificationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WebhookVerificationError';
  }
}

export type SignedHeaders = {
  'webhook-id': string;
  'webhook-timestamp': string;
  'webhook-signature': string;
};

/** A new endpoint secret: `whsec_` + base64 of 32 random bytes (the spec allows 24 to 64). */
export function generateSecret(bytes = 32): string {
  return SECRET_PREFIX + toBase64(crypto.getRandomValues(new Uint8Array(bytes)));
}

function secretBytes(secret: string): Uint8Array<ArrayBuffer> {
  const raw = secret.startsWith(SECRET_PREFIX) ? secret.slice(SECRET_PREFIX.length) : secret;
  const bytes = fromBase64(raw);
  if (bytes.length < 24 || bytes.length > 64) throw new WebhookVerificationError('Secret must decode to 24–64 bytes');
  return bytes;
}

async function hmac(secret: string, content: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', secretBytes(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const mac = await crypto.subtle.sign('HMAC', key, encoder.encode(content));
  return toBase64(new Uint8Array(mac));
}

export async function sign(secret: string, id: string, timestamp: number, body: string): Promise<string> {
  assertId(id);
  return `v1,${await hmac(secret, `${id}.${Math.floor(timestamp)}.${body}`)}`;
}

/**
 * Headers for one delivery attempt. The ID stays stable across retries; the timestamp is per attempt.
 * Pass several secrets while one is being rotated out: each signs the same content and the header lists
 * every signature (`v1,<sig> v1,<sig>`), so a receiver holding either secret verifies.
 */
export async function signHeaders(secrets: string | string[], id: string, body: string, now: Date = new Date()): Promise<SignedHeaders> {
  const list = Array.isArray(secrets) ? secrets : [secrets];
  if (!list.length) throw new WebhookVerificationError('At least one secret is needed to sign');
  const timestamp = Math.floor(now.getTime() / 1000);
  return {
    'webhook-id': id,
    'webhook-timestamp': String(timestamp),
    'webhook-signature': (await Promise.all(list.map((secret) => sign(secret, id, timestamp, body)))).join(' '),
  };
}

export interface VerifyOptions {
  /** Accept timestamps this many seconds either side of now. Default 300. */
  toleranceSeconds?: number;
  now?: Date;
}

/**
 * Verify a received webhook. Pass the exact raw body bytes as text. `secrets` may hold several
 * secrets during rotation. Throws WebhookVerificationError; returns the parsed timestamp on success.
 */
export async function verify(
  headers: Headers | Record<string, string | undefined>,
  body: string,
  secrets: string | string[],
  { toleranceSeconds = 300, now = new Date() }: VerifyOptions = {},
): Promise<{ id: string; timestamp: number }> {
  const get = (name: string) => (headers instanceof Headers ? headers.get(name) : (headers[name] ?? headers[name.toLowerCase()])) ?? undefined;
  const id = get('webhook-id');
  const ts = get('webhook-timestamp');
  const sig = get('webhook-signature');
  if (!id || !ts || !sig) throw new WebhookVerificationError('Missing webhook-id, webhook-timestamp or webhook-signature');
  assertId(id);
  if (!/^\d+$/.test(ts)) throw new WebhookVerificationError('Invalid webhook-timestamp');
  const timestamp = Number(ts);
  const nowSec = Math.floor(now.getTime() / 1000);
  if (Math.abs(nowSec - timestamp) > toleranceSeconds) throw new WebhookVerificationError('Timestamp outside the tolerance window');

  const offered = sig.split(' ').flatMap((part) => {
    const [version, value] = part.split(',', 2);
    return version === 'v1' && value ? [value] : [];
  });
  if (!offered.length) throw new WebhookVerificationError('No v1 signature');
  for (const secret of Array.isArray(secrets) ? secrets : [secrets]) {
    const expected = await hmac(secret, `${id}.${timestamp}.${body}`);
    if (offered.some((o) => timingSafeEqual(o, expected))) return { id, timestamp };
  }
  throw new WebhookVerificationError('No matching signature');
}

function assertId(id: string) {
  // The id is part of the signed content; a period inside it would make the content ambiguous.
  if (!id || id.includes('.') || id.length > 255) throw new WebhookVerificationError('Invalid webhook-id');
}

function timingSafeEqual(a: string, b: string): boolean {
  const x = encoder.encode(a);
  const y = encoder.encode(b);
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
}

export function toBase64(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

export function fromBase64(text: string): Uint8Array<ArrayBuffer> {
  const bin = atob(text);
  const out = new Uint8Array(new ArrayBuffer(bin.length));
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
