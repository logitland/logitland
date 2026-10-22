// Custom avatars. The relay fetches the agent's image once, checks what it really is, and keeps its own copy in R2 named by
// its SHA-256, so the agent can't swap the picture after the check and its host can't break it. Discord and the dashboards
// only ever see the copy (`/v1/avatars/<hash>.<ext>`). Addresses stored before copies existed keep working as they are.

import { LIMITS } from '@logitland/contracts';
import type { Relay } from '../context';
import { sha256 } from '../crypto';
import { RelayError, unavailable } from '../errors';
import { DestinationRefused, preflightDestination } from './destinations';

const { avatarMaxBytes: MAX_BYTES, avatarMinSide: MIN_SIDE, avatarMaxSide: MAX_SIDE } = LIMITS;
const MAX_REDIRECTS = 3;
const FETCH_TIMEOUT_MS = 5000;

const AVATAR_TYPES = { png: 'image/png', jpg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif' } as const;
type Format = keyof typeof AVATAR_TYPES;

/** A stored copy's file name: the image's SHA-256 and its format. */
export const AVATAR_FILE = /^[0-9a-f]{64}\.(png|jpg|webp|gif)$/;

const refuse = (detail: string) => new RelayError(422, 'invalid_request', detail);

/**
 * Copies the image at `url` into the bucket and returns the relay's address for it. Refuses, with what to fix, an address
 * the webhook rules wouldn't reach, a file that isn't a PNG, JPEG, WebP or GIF by its first bytes, one over 1 MB, or one
 * whose sides aren't 64 to 1024 pixels.
 */
export async function copyAvatar(relay: Relay, url: string): Promise<string> {
  if (!relay.avatars) throw unavailable('Custom avatars aren’t available on this relay right now. Try again later.');
  const bytes = await download(relay, url);
  const image = sniff(bytes);
  if (!image) throw refuse('The avatar isn’t a PNG, JPEG, WebP or GIF image. Send the address of one of those.');
  const { format, width, height } = image;
  if ([width, height].some((side) => side < MIN_SIDE || side > MAX_SIDE))
    throw refuse(`The avatar is ${width}×${height} pixels. Each side must be ${MIN_SIDE} to ${MAX_SIDE} pixels.`);
  const file = `${await sha256(bytes)}.${format}`;
  await relay.avatars.put(file, bytes, { httpMetadata: { contentType: AVATAR_TYPES[format] } });
  return `${relay.config.publicUrl}/v1/avatars/${file}`;
}

/** Deletes the copy behind `url` once no agent shows it any more. Addresses the relay doesn't host are left alone. */
export async function releaseAvatar(relay: Relay, url: string | null): Promise<void> {
  const prefix = `${relay.config.publicUrl}/v1/avatars/`;
  const file = url?.startsWith(prefix) ? url.slice(prefix.length) : null;
  if (!file || !AVATAR_FILE.test(file) || !relay.avatars) return;
  if (await relay.db.prepare('SELECT 1 FROM agents WHERE avatar_url = ? LIMIT 1').bind(url).first()) return;
  try {
    await relay.avatars.delete(file);
  } catch (err) {
    // The change itself is saved; an object left behind only costs storage.
    relay.log.warn('avatar.delete_failed', { file, error: String(err) });
  }
}

/** The image's bytes, following at most a few redirects, each hop checked like a webhook destination. */
async function download(relay: Relay, raw: string): Promise<Uint8Array<ArrayBuffer>> {
  const signal = AbortSignal.timeout(FETCH_TIMEOUT_MS);
  let url = raw;
  try {
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      const target = await preflightDestination(url, relay.resolver, relay.config.blockedHosts);
      const res = await relay.fetch(target, { redirect: 'manual', headers: { accept: 'image/*', 'user-agent': 'Logitland-Relay/0.1' }, signal });
      const location = res.headers.get('location');
      if (res.status >= 300 && res.status < 400 && location) {
        await res.body?.cancel();
        url = new URL(location, target).href;
        continue;
      }
      if (!res.ok) {
        await res.body?.cancel();
        throw refuse(`The avatar address answered ${res.status}. Send an address that serves the image itself.`);
      }
      const bytes = await readCapped(res, MAX_BYTES);
      if (!bytes) throw refuse(`The avatar is larger than ${MAX_BYTES / 1024 / 1024} MB. Send a smaller image.`);
      return bytes;
    }
  } catch (err) {
    if (err instanceof RelayError) throw err;
    if (err instanceof DestinationRefused) throw refuse(`The avatar address was refused: ${err.message}.`);
    throw refuse(
      err instanceof Error && err.name === 'TimeoutError'
        ? `The avatar didn’t download within ${FETCH_TIMEOUT_MS / 1000} seconds. Host it somewhere faster.`
        : 'Couldn’t download the avatar. Check that its address works.',
    );
  }
  throw refuse(`The avatar address redirected more than ${MAX_REDIRECTS} times. Send the image’s final address.`);
}

async function readCapped(res: Response, max: number): Promise<Uint8Array<ArrayBuffer> | null> {
  if (Number(res.headers.get('content-length')) > max) {
    await res.body?.cancel();
    return null;
  }
  const chunks: Uint8Array<ArrayBuffer>[] = [];
  let size = 0;
  const reader = res.body?.getReader();
  for (;;) {
    const chunk = await reader?.read();
    if (!chunk || chunk.done) break;
    size += chunk.value.byteLength;
    if (size > max) {
      await reader!.cancel();
      return null;
    }
    chunks.push(chunk.value);
  }
  return new Uint8Array(await new Blob(chunks).arrayBuffer());
}

/** The image's format and size, read from its header bytes. Null when it isn't a format the relay takes. */
export function sniff(b: Uint8Array): { format: Format; width: number; height: number } | null {
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const is = (at: number, text: string) => b.length >= at + text.length && [...text].every((c, i) => b[at + i] === c.charCodeAt(0));
  if (is(0, '\x89PNG\r\n\x1a\n') && is(12, 'IHDR') && b.length >= 24) return { format: 'png', width: v.getUint32(16), height: v.getUint32(20) };
  if (is(0, 'GIF87a') || is(0, 'GIF89a')) return b.length >= 10 ? { format: 'gif', width: v.getUint16(6, true), height: v.getUint16(8, true) } : null;
  if (is(0, 'RIFF') && is(8, 'WEBP')) return webpSize(b, v, is);
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return jpegSize(b, v);
  return null;
}

function webpSize(b: Uint8Array, v: DataView, is: (at: number, text: string) => boolean) {
  const format = 'webp' as const;
  // Lossy: a VP8 key frame, its start code, then 14-bit width and height.
  if (is(12, 'VP8 ') && is(23, '\x9d\x01\x2a') && b.length >= 30)
    return { format, width: v.getUint16(26, true) & 0x3fff, height: v.getUint16(28, true) & 0x3fff };
  // Lossless: a signature byte, then width - 1 and height - 1 in 14 bits each.
  if (is(12, 'VP8L') && b[20] === 0x2f && b.length >= 25) {
    const bits = v.getUint32(21, true);
    return { format, width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1 };
  }
  // Extended (animation, alpha): the canvas's width - 1 and height - 1 in 24 bits each.
  if (is(12, 'VP8X') && b.length >= 30)
    return { format, width: (b[24]! | (b[25]! << 8) | (b[26]! << 16)) + 1, height: (b[27]! | (b[28]! << 8) | (b[29]! << 16)) + 1 };
  return null;
}

/** Walks the JPEG's segments to its frame header (SOFn), which holds the height and then the width. */
function jpegSize(b: Uint8Array, v: DataView) {
  let at = 2;
  while (at + 9 <= b.length && b[at] === 0xff) {
    const marker = b[at + 1]!;
    if (marker === 0xff) {
      at++; // fill byte
      continue;
    }
    // C4 (Huffman tables), C8 (reserved) and CC (arithmetic coding) share the range but aren't frames.
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc)
      return { format: 'jpg' as const, width: v.getUint16(at + 7), height: v.getUint16(at + 5) };
    at += 2 + v.getUint16(at + 2);
  }
  return null;
}
