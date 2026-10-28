// Randomness, hashing and at-rest encryption, all WebCrypto so they run in Workers and Node.

const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const encoder = new TextEncoder();
const decoder = new TextDecoder();

export function base32(bytes: Uint8Array): string {
  let out = '';
  let acc = 0;
  let bits = 0;
  for (const b of bytes) {
    acc = (acc << 8) | b;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      out += CROCKFORD[(acc >> bits) & 31];
    }
  }
  if (bits > 0) out += CROCKFORD[(acc << (5 - bits)) & 31];
  return out;
}

/** An opaque secret with a recognisable prefix, e.g. `lk_…` for relay keys (240 bits by default). */
export function randomToken(prefix: string, bytes = 30): string {
  return `${prefix}${base32(crypto.getRandomValues(new Uint8Array(bytes)))}`;
}

/** A claim code like 7QFM-KX2D: 8 Crockford characters, 40 bits. */
export function userCode(): string {
  const s = base32(crypto.getRandomValues(new Uint8Array(5))).slice(0, 8);
  return `${s.slice(0, 4)}-${s.slice(4)}`;
}

const hex = (buf: ArrayBuffer) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');

export async function sha256(data: string | Uint8Array<ArrayBuffer>): Promise<string> {
  return hex(await crypto.subtle.digest('SHA-256', typeof data === 'string' ? encoder.encode(data) : data));
}

/** HMAC-SHA256 as hex. Used for IP and author pseudonyms, so the key (IP_HASH_KEY) must stay secret. */
export async function hmac(key: string, text: string): Promise<string> {
  const k = await crypto.subtle.importKey('raw', encoder.encode(key), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return hex(await crypto.subtle.sign('HMAC', k, encoder.encode(text)));
}

export function timingSafeEqual(a: string, b: string): boolean {
  const x = encoder.encode(a);
  const y = encoder.encode(b);
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
}

export function b64(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

function unb64(text: string): Uint8Array<ArrayBuffer> {
  const bin = atob(text);
  const out = new Uint8Array(new ArrayBuffer(bin.length));
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/**
 * AES-256-GCM for secrets the relay must read back (Discord webhook URLs, destination URLs, signing secrets,
 * raw IPs). Ciphertext: `v2.<key id>.<iv>.<ciphertext>`. The associated data names where the value lives
 * (for example `channels.webhook:<channel id>`), so a ciphertext copied to another row won't open.
 *
 * Rotation: set RELAY_SECRET_KEY to the new key with a new RELAY_SECRET_KEY_ID (the first key's ID is k1 unless set),
 * list the old ones in RELAY_SECRET_KEYS_OLD as `id:base64,id:base64` under the IDs they were sealed with, run the
 * re-seal job, then drop the old keys.
 */
export class SecretBox {
  private readonly keys = new Map<string, Promise<CryptoKey>>();
  /** HMAC keys derived from the same secrets (HKDF, info `logitland signing`), for what the relay signs and checks itself. */
  private readonly signing = new Map<string, Promise<CryptoKey>>();

  constructor(current: { id: string; key: string }, old: { id: string; key: string }[] = []) {
    for (const k of [current, ...old]) {
      if (!/^[A-Za-z0-9_-]{1,16}$/.test(k.id)) throw new Error('Secret key IDs are 1 to 16 letters, digits, - or _');
      // A second key under an ID already in use would silently replace the first (and seal with the wrong one).
      if (this.keys.has(k.id)) throw new Error(`Secret key ID ${k.id} is used twice; give the new key an ID of its own`);
      const raw = unb64(k.key);
      if (raw.length !== 32) throw new Error(`Secret key ${k.id} must be 32 bytes, base64-encoded`);
      this.keys.set(k.id, crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']));
      this.signing.set(
        k.id,
        crypto.subtle
          .importKey('raw', raw, 'HKDF', false, ['deriveKey'])
          .then((base) =>
            crypto.subtle.deriveKey(
              { name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(32), info: encoder.encode('logitland signing') },
              base,
              { name: 'HMAC', hash: 'SHA-256', length: 256 },
              false,
              ['sign', 'verify'],
            ),
          ),
      );
    }
    this.currentId = current.id;
  }

  /** HMAC-SHA256 of `data` with the signing key `kid` (use currentId for new signatures). */
  async sign(kid: string, data: string): Promise<Uint8Array> {
    const key = this.signing.get(kid);
    if (!key) throw new Error(`No secret key with ID ${kid}`);
    return new Uint8Array(await crypto.subtle.sign('HMAC', await key, encoder.encode(data)));
  }

  /** Whether `signature` is `data` signed with key `kid`. An unknown key ID is false, not an error. */
  async verify(kid: string, data: string, signature: Uint8Array<ArrayBuffer>): Promise<boolean> {
    const key = this.signing.get(kid);
    return key ? crypto.subtle.verify('HMAC', await key, signature, encoder.encode(data)) : false;
  }

  readonly currentId: string;

  async seal(plaintext: string, aad: string): Promise<string> {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const key = await this.keys.get(this.currentId)!;
    const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: encoder.encode(aad) }, key, encoder.encode(plaintext));
    return `v2.${this.currentId}.${b64(iv)}.${b64(new Uint8Array(ct))}`;
  }

  async open(sealed: string, aad: string): Promise<string> {
    const [version, kid, iv, ct] = sealed.split('.');
    if (version !== 'v2' || !kid || !iv || !ct) throw new Error('Unknown ciphertext format');
    const key = this.keys.get(kid);
    if (!key) throw new Error(`No secret key with ID ${kid}`);
    const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(iv), additionalData: encoder.encode(aad) }, await key, unb64(ct));
    return decoder.decode(pt);
  }

  /** True when the value was sealed with an older key and should be re-sealed. */
  isStale(sealed: string): boolean {
    return sealed.split('.')[1] !== this.currentId;
  }

  static generateKey(): string {
    return b64(crypto.getRandomValues(new Uint8Array(32)));
  }
}
