// Files on messages. Intake records what Discord says about each file on a message it keeps (`attachmentStmts`), and message
// events list them with the relay's own address for each (`eventAttachments`), never Discord's: its CDN refuses some agents,
// and its addresses expire. The first request for a file copies it from the CDN into the ATTACHMENTS bucket; later ones are
// served from the copy. A file is served to whoever may read its message, as its event was: the channel's readers, or the
// members of a private conversation. A removed message's files stop being served at once (scrub.ts), as do files an edit
// dropped and files older than the event log (retention.ts); `attachmentsJob` then deletes their copies.

import { LIMITS, type MessageAttachment } from '@logitland/contracts';
import { DiscordError } from '@logitland/discord';
import { iso, type Relay, type Stmt } from '../context';
import { RelayError, notFound, unavailable } from '../errors';
import { readCapped } from './avatars';
import { usableChannel, type Viewer } from './channels';
import { inPrivateSql } from './conversation';
import { membership } from './conversations';

const { attachmentMaxBytes: MAX_BYTES } = LIMITS;
const FETCH_TIMEOUT_MS = 20_000;
/** Refresh a signed CDN address this close to its expiry rather than fetch it. */
const EXPIRY_MARGIN_MS = 60_000;
/** Removed files whose copies one run of the job deletes: R2 deletes up to 1,000 keys per call. */
const SWEEP_BATCH = 1000;
/** Where Discord serves files. In development, the fake Discord's own origin is accepted too (`allowedSource`). */
const DISCORD_CDN = new Set(['https://cdn.discordapp.com', 'https://media.discordapp.net']);

/**
 * The types served for display, as sent. Anything else is served as a download (`application/octet-stream`), so a browser never
 * runs an HTML or SVG file from the relay's origin. A Map, so a type like `constructor` finds nothing.
 */
const INLINE_TYPES = new Map([
  ['image/png', 'image/png'],
  ['image/jpeg', 'image/jpeg'],
  ['image/gif', 'image/gif'],
  ['image/webp', 'image/webp'],
  ['image/avif', 'image/avif'],
  ['text/plain', 'text/plain; charset=utf-8'],
]);

/** A file as Discord describes it on a message (intake.ts validates it). */
export interface DiscordAttachment {
  id: string;
  filename: string;
  content_type?: string | null;
  size: number;
  /** Discord's signed CDN address. Kept to fetch the file; never shown. */
  url: string;
  width?: number | null;
  height?: number | null;
}

const attachmentUrl = (relay: Relay, id: string) => `${relay.config.publicUrl}/v1/attachments/${id}`;

/** How message events list a message's files. */
export function eventAttachments(relay: Relay, files: DiscordAttachment[]): MessageAttachment[] {
  return files.map((a) => ({
    id: a.id,
    filename: a.filename,
    content_type: a.content_type ?? null,
    size: a.size,
    ...(a.width == null || a.height == null ? {} : { width: a.width, height: a.height }),
    url: attachmentUrl(relay, a.id),
  }));
}

/**
 * Records a message's files, if the relay keeps the message (a person's message it dropped, or one already removed, gets none).
 * `editedAt`: the files are everything the message has now, as of the edit made then, so any other file the relay holds for it
 * is removed. Both apply only if the edit's text did, in the statements before these: an edit intake turns away (its author
 * had withdrawn, or a newer edit committed first) changes no file.
 */
export function attachmentStmts(
  relay: Relay,
  m: { message_id: string; channel_id: string; thread_id?: string | null; attachments: DiscordAttachment[] },
  editedAt: string | null,
): Stmt[] {
  const now = iso(relay.now());
  const kept = `EXISTS (SELECT 1 FROM conversation c WHERE c.message_id = ? AND c.deleted_at IS NULL${editedAt === null ? '' : ' AND c.edited_at = ?'})`;
  const keptArgs = editedAt === null ? [m.message_id] : [m.message_id, editedAt];
  const stmts: Stmt[] = [];
  if (editedAt !== null)
    stmts.push(
      relay.db
        .prepare(`UPDATE attachments SET removed_at = ? WHERE message_id = ? AND removed_at IS NULL AND id NOT IN (SELECT value FROM json_each(?)) AND ${kept}`)
        .bind(now, m.message_id, JSON.stringify(m.attachments.map((a) => a.id)), ...keptArgs),
    );
  if (m.attachments.length)
    stmts.push(
      relay.db
        .prepare(
          `INSERT OR IGNORE INTO attachments (id, message_id, channel_id, thread_id, filename, content_type, size, width, height, source_url, created_at)
           SELECT json_extract(j.value, '$.id'), ?, ?, ?, json_extract(j.value, '$.filename'), json_extract(j.value, '$.content_type'),
             json_extract(j.value, '$.size'), json_extract(j.value, '$.width'), json_extract(j.value, '$.height'), json_extract(j.value, '$.url'), ?
           FROM json_each(?) j WHERE ${kept}`,
        )
        .bind(m.message_id, m.channel_id, m.thread_id ?? null, now, JSON.stringify(m.attachments), ...keptArgs),
    );
  return stmts;
}

/** Stops serving the files of these messages; `attachmentsJob` deletes the copies. Safe to repeat. */
export const removeAttachmentsStmt = (relay: Relay, messageIds: string[]): Stmt =>
  relay.db
    .prepare('UPDATE attachments SET removed_at = ? WHERE removed_at IS NULL AND message_id IN (SELECT value FROM json_each(?))')
    .bind(iso(relay.now()), JSON.stringify(messageIds));

interface AttachmentRow {
  id: string;
  channel_id: string;
  thread_id: string | null;
  filename: string;
  content_type: string | null;
  size: number;
  source_url: string;
  private: number;
}

/** Who asks for a file: the channel view they read with, and the agent, when it sent a token. */
export interface AttachmentReader {
  viewer: Viewer;
  agentId: string | null;
}

/**
 * GET /v1/attachments/:id. The file, to whoever may read its message; 404 for anyone else, so nobody learns a file exists
 * that they can't read. Files over LIMITS.attachmentMaxBytes are refused.
 */
export async function serveAttachment(relay: Relay, reader: AttachmentReader, id: string): Promise<Response> {
  const refused = notFound('No such file, or you can’t read the message it’s on.');
  if (!/^\d{17,20}$/.test(id)) throw refused;
  const row = await relay.db
    .prepare(
      `SELECT a.id, a.channel_id, a.thread_id, a.filename, a.content_type, a.size, a.source_url, ${inPrivateSql('c')} AS private
       FROM attachments a JOIN conversation c ON c.message_id = a.message_id WHERE a.id = ? AND a.removed_at IS NULL AND c.deleted_at IS NULL`,
    )
    .bind(id)
    .first<AttachmentRow>();
  if (!row || !(await mayRead(relay, reader, row))) throw refused;
  if (row.size > MAX_BYTES) throw tooLarge();
  const bucket = relay.attachments;
  if (!bucket) throw unavailable('Files aren’t available on this relay right now. Try again later.');
  const copy = await bucket.get(row.id);
  if (copy) return new Response(copy.body, { headers: { ...servingHeaders(row), 'content-length': String(copy.size) } });
  const bytes = await download(relay, row);
  await bucket.put(row.id, bytes, { httpMetadata: { contentType: row.content_type ?? 'application/octet-stream' } });
  // Removed while it downloaded: the job may already have swept it, so the copy just made would stay forever.
  if (!(await relay.db.prepare('SELECT 1 AS x FROM attachments WHERE id = ? AND removed_at IS NULL').bind(row.id).first())) {
    await bucket.delete(row.id);
    throw refused;
  }
  return new Response(bytes, { headers: { ...servingHeaders(row), 'content-length': String(bytes.byteLength) } });
}

/** A private conversation's files are for its joined members; any other file for whoever may read its channel. */
async function mayRead(relay: Relay, reader: AttachmentReader, row: AttachmentRow): Promise<boolean> {
  if (row.private) return reader.agentId !== null && (await membership(relay, row.thread_id!, reader.agentId)) === 'joined';
  try {
    await usableChannel(relay, reader.viewer, row.channel_id, 'read');
    return true;
  } catch (err) {
    if (err instanceof RelayError) return false;
    throw err;
  }
}

const tooLarge = () => new RelayError(413, 'payload_too_large', `This file is larger than ${MAX_BYTES / 1024 / 1024} MB, the most the relay serves.`);

function servingHeaders(row: Pick<AttachmentRow, 'filename' | 'content_type'>): Record<string, string> {
  const inline = INLINE_TYPES.get((row.content_type ?? '').split(';')[0]!.trim().toLowerCase());
  // RFC 6266: a plain-ASCII name for old clients, and the real one percent-encoded (RFC 8187).
  const ascii = row.filename.replace(/[^\x20-\x7e]|["\\]/g, '_');
  const encoded = encodeURIComponent(row.filename).replace(/['()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
  return {
    'content-type': inline ?? 'application/octet-stream',
    'content-disposition': `${inline ? 'inline' : 'attachment'}; filename="${ascii}"; filename*=UTF-8''${encoded}`,
    'x-content-type-options': 'nosniff',
    'content-security-policy': "default-src 'none'; sandbox",
    'cache-control': 'private, no-store',
  };
}

/** Whether `url` is where Discord serves files, so a stored address never sends the relay anywhere else. */
function allowedSource(relay: Relay, url: string): boolean {
  const origin = URL.canParse(url) ? new URL(url).origin : '';
  return DISCORD_CDN.has(origin) || (relay.config.development && origin === new URL(relay.discord.apiBase).origin);
}

/** Whether a signed CDN address has expired, or is about to: `ex` is its expiry, in hexadecimal Unix seconds. */
function expired(relay: Relay, url: string): boolean {
  const ex = Number.parseInt(new URL(url).searchParams.get('ex') ?? '', 16);
  return Number.isFinite(ex) && ex * 1000 <= relay.now().getTime() + EXPIRY_MARGIN_MS;
}

/**
 * The file's bytes from Discord's CDN. An address that expired, or that the CDN refuses, is refreshed through Discord's API once
 * and the new one kept.
 */
async function download(relay: Relay, row: AttachmentRow): Promise<Uint8Array<ArrayBuffer>> {
  const failed = (status: number | string) => {
    relay.log.warn('attachment.download_failed', { attachment_id: row.id, status });
    return unavailable('Discord didn’t serve this file. Try again later.');
  };
  let url = row.source_url;
  let refreshed = false;
  const refresh = async () => {
    let fresh: { refreshed: string } | undefined;
    try {
      [fresh] = await relay.discord.refreshAttachmentUrls([url]);
    } catch (err) {
      throw failed(err instanceof DiscordError ? `refresh ${err.status}` : 'refresh failed');
    }
    if (!fresh) throw failed('refresh empty');
    url = fresh.refreshed;
    refreshed = true;
    await relay.db.prepare('UPDATE attachments SET source_url = ? WHERE id = ?').bind(url, row.id).run();
  };
  const get = async () => {
    if (!allowedSource(relay, url)) throw failed('not a Discord address');
    try {
      return await relay.fetch(url, { redirect: 'manual', headers: { 'user-agent': 'Logitland-Relay/0.1' }, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    } catch (err) {
      throw failed(err instanceof Error && err.name === 'TimeoutError' ? 'timeout' : 'network');
    }
  };
  if (expired(relay, url)) await refresh();
  let res = await get();
  if ((res.status === 403 || res.status === 404) && !refreshed) {
    await res.body?.cancel();
    await refresh();
    res = await get();
  }
  if (!res.ok) {
    await res.body?.cancel();
    throw failed(res.status);
  }
  const bytes = await readCapped(res, MAX_BYTES);
  if (!bytes) throw tooLarge();
  return bytes;
}

/** Cron: deletes the copies of files no longer served, then their rows. Returns how many it removed. */
export async function attachmentsJob(relay: Relay): Promise<number> {
  const { results } = await relay.db.prepare('SELECT id FROM attachments WHERE removed_at IS NOT NULL LIMIT ?').bind(SWEEP_BATCH).all<{ id: string }>();
  if (!results.length) return 0;
  const ids = results.map((r) => r.id);
  await relay.attachments?.delete(ids);
  await relay.db.prepare('DELETE FROM attachments WHERE id IN (SELECT value FROM json_each(?))').bind(JSON.stringify(ids)).run();
  return ids.length;
}
