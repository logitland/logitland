import { LIMITS } from '@logitland/contracts';
import { iso, type Relay, type Stmt } from '../context';
import { hmac } from '../crypto';
import { forbidden } from '../errors';
import type { ClientInfo } from '../types';

// Where agents connect from. Keyed hashes are kept 90 days after last seen (longer for banned agents, until their ban record
// expires), the raw address sealed for 30 days.

const DAY_MS = 86_400_000;
/** Rows one cleanup statement touches, and how many statements one run may use, so a backlog is worked off without a long query. */
const CLEANUP_BATCH = 500;
const CLEANUP_ROUNDS = 20;
const originAad = (agentId: string) => `agent_origins.ip:${agentId}`;

interface ParsedIp {
  /** What one host can be told apart by: the dotted quad, or the /64 of an IPv6 address (one subscriber always gets at least a /64). */
  address: string;
  /** The /24 (IPv4) or /48 (IPv6) the address belongs to. */
  network: string;
}

function parseIpv4(text: string): number[] | null {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(text);
  if (!m) return null;
  const parts = m.slice(1).map(Number);
  return parts.every((n) => n <= 255) ? parts : null;
}

function parseIpv6(text: string): number[] | null {
  let head = text;
  let tail: number[] = [];
  const v4 = /(\d+\.\d+\.\d+\.\d+)$/.exec(text);
  if (v4) {
    const q = parseIpv4(v4[1]!);
    if (!q) return null;
    tail = [(q[0]! << 8) | q[1]!, (q[2]! << 8) | q[3]!];
    head = text.slice(0, -v4[1]!.length) + '0:0';
  }
  const halves = head.split('::');
  if (halves.length > 2) return null;
  const toGroups = (s: string) => (s === '' ? [] : s.split(':'));
  const left = toGroups(halves[0]!);
  const right = halves.length === 2 ? toGroups(halves[1]!) : [];
  const fill = 8 - left.length - right.length;
  if (halves.length === 2 ? fill < 1 : fill !== 0) return null;
  const groups = [...left, ...Array<string>(halves.length === 2 ? fill : 0).fill('0'), ...right];
  if (!groups.every((g) => /^[0-9a-f]{1,4}$/i.test(g))) return null;
  const numbers = groups.map((g) => parseInt(g, 16));
  if (v4) numbers.splice(6, 2, ...tail);
  return numbers;
}

/** Normalises an address so every spelling of it hashes the same. Anything unparseable is hashed as written. */
function parseIp(raw: string): ParsedIp {
  const text = raw
    .trim()
    .replace(/^\[|\]$/g, '')
    .replace(/%.*$/, '')
    .toLowerCase();
  const v4 = parseIpv4(text);
  if (v4) return { address: v4.join('.'), network: `${v4.slice(0, 3).join('.')}.0/24` };
  const v6 = text.includes(':') ? parseIpv6(text) : null;
  if (!v6) return { address: text, network: text };
  // ::ffff:a.b.c.d is an IPv4 client reaching us over IPv6.
  if (v6.slice(0, 5).every((g) => g === 0) && v6[5] === 0xffff) {
    const q = [v6[6]! >> 8, v6[6]! & 255, v6[7]! >> 8, v6[7]! & 255];
    return { address: q.join('.'), network: `${q.slice(0, 3).join('.')}.0/24` };
  }
  const hextets = v6.map((g) => g.toString(16).padStart(4, '0'));
  return { address: `${hextets.slice(0, 4).join(':')}::/64`, network: `${hextets.slice(0, 3).join(':')}::/48` };
}

/**
 * Workers calling from another zone all reach us from this address (developers.cloudflare.com/fundamentals/reference/http-headers,
 * "CF-Connecting-IP"), with the zone that owns the Worker in CF-Worker. Limits and bans for them follow that zone, not the address
 * every Worker shares.
 */
export const isWorkerAddress = (ip: string): boolean =>
  parseIpv6(
    ip
      .trim()
      .replace(/^\[|\]$/g, '')
      .toLowerCase(),
  )?.join(':') === '10758:39104:13824:0:0:0:0:259';

/**
 * HMACs of the caller's address (IPv4, or the /64 of an IPv6 address) and of its network (IPv4 /24, IPv6 /48), for rate-limit
 * keys and bans. A person can move around inside their own /64 for free, so nothing is limited more finely than that. Null without an IP.
 */
export async function clientHashes(relay: Relay, client: ClientInfo): Promise<{ ip: string | null; net: string | null }> {
  if (!client.ip) return { ip: null, net: null };
  if (client.worker) {
    const zone = await hmac(relay.config.hashKey, `worker:${client.worker}`);
    return { ip: zone, net: zone };
  }
  const { address, network } = parseIp(client.ip);
  return { ip: await hmac(relay.config.hashKey, `ip:${address}`), net: await hmac(relay.config.hashKey, `net:${network}`) };
}

/** The insert for one origin row, so signup can write it in the same batch as the agent. Null when the request had no IP. */
export async function originStmt(relay: Relay, agentId: string, client: ClientInfo, kind: 'signup' | 'use'): Promise<Stmt | null> {
  if (!client.ip) return null;
  const { ip, net } = await clientHashes(relay, client);
  const now = relay.now();
  return relay.db
    .prepare(
      'INSERT INTO agent_origins (agent_id, kind, ip_hmac, net_hmac, asn, as_org, country, ip_sealed, ip_purge_after, seen_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    )
    .bind(
      agentId,
      kind,
      ip,
      net,
      client.asn,
      client.asOrganization,
      client.country,
      await relay.secrets.seal(client.ip, originAad(agentId)),
      iso(new Date(now.getTime() + LIMITS.rawIpRetentionDays * DAY_MS)),
      iso(now),
    );
}

export async function recordOrigin(relay: Relay, agentId: string, client: ClientInfo, kind: 'signup' | 'use'): Promise<void> {
  await (await originStmt(relay, agentId, client, kind))?.run();
}

/** Cron: clear sealed raw IPs past their purge time, and delete challenges that expired an hour ago. Returns the IPs purged. */
export async function purgeRawIpsJob(relay: Relay): Promise<number> {
  const now = relay.now();
  let purged = 0;
  for (let i = 0; i < CLEANUP_ROUNDS; i++) {
    const r = await relay.db
      .prepare('UPDATE agent_origins SET ip_sealed = NULL, ip_purge_after = NULL WHERE id IN (SELECT id FROM agent_origins WHERE ip_purge_after <= ? LIMIT ?)')
      .bind(iso(now), CLEANUP_BATCH)
      .run();
    purged += r.meta.changes;
    if (r.meta.changes < CLEANUP_BATCH) break;
  }
  const cutoff = iso(new Date(now.getTime() - 3_600_000));
  for (let i = 0; i < CLEANUP_ROUNDS; i++) {
    const r = await relay.db
      .prepare('DELETE FROM pow_challenges WHERE id IN (SELECT id FROM pow_challenges WHERE expires_at < ? LIMIT ?)')
      .bind(cutoff, CLEANUP_BATCH)
      .run();
    if (r.meta.changes < CLEANUP_BATCH) break;
  }
  return purged;
}

/**
 * Cron: origin rows older than the retention are deleted, except those of an agent whose ban record is still running, and
 * expired ban records go. Returns the rows deleted.
 */
export async function pruneOriginsJob(relay: Relay): Promise<number> {
  const now = relay.now();
  const cutoff = iso(new Date(now.getTime() - LIMITS.originRetentionDays * DAY_MS));
  let removed = 0;
  for (let i = 0; i < CLEANUP_ROUNDS; i++) {
    const r = await relay.db
      .prepare(
        'DELETE FROM agent_origins WHERE id IN (SELECT o.id FROM agent_origins o WHERE o.seen_at < ? AND NOT EXISTS (SELECT 1 FROM banned_origins b WHERE b.agent_id = o.agent_id AND b.expires_at > ?) LIMIT ?)',
      )
      .bind(cutoff, iso(now), CLEANUP_BATCH)
      .run();
    removed += r.meta.changes;
    if (r.meta.changes < CLEANUP_BATCH) break;
  }
  const bans = await relay.db.prepare('DELETE FROM banned_origins WHERE expires_at <= ?').bind(iso(now)).run();
  return removed + bans.meta.changes;
}

/* ---------- Bans ---------- */

/** Refuses a request from an address or network that belongs to a banned agent whose ban record is still running. */
export async function assertOriginNotBanned(relay: Relay, client: ClientInfo): Promise<void> {
  const { ip, net } = await clientHashes(relay, client);
  const hashes = [ip, net].filter((h): h is string => h !== null);
  if (!hashes.length) return;
  const banned = await relay.db
    .prepare(`SELECT 1 AS x FROM banned_origins WHERE hash IN (${hashes.map(() => '?').join(', ')}) AND expires_at > ? LIMIT 1`)
    .bind(...hashes, iso(relay.now()))
    .first();
  if (banned) throw forbidden('Signups from this network aren’t accepted.');
}

/**
 * The statements that record where a banned agent connected from, for the batch that bans it: every address on file, but only
 * the network it signed up from, so a ban doesn't close the public VPN or cloud ranges it later used. `guard` is the batch's
 * precondition, so a ban that loses a race leaves no record.
 */
export function banOriginStmts(relay: Relay, agentId: string, guard: string, ...guardBinds: unknown[]): Stmt[] {
  const now = relay.now();
  const created = iso(now);
  const expires = iso(new Date(now.getTime() + LIMITS.bannedOriginDays * DAY_MS));
  return (['ip', 'net'] as const).map((kind) =>
    relay.db
      .prepare(
        `INSERT INTO banned_origins (hash, kind, agent_id, created_at, expires_at) SELECT DISTINCT ${kind}_hmac, '${kind}', agent_id, ?, ? FROM agent_origins WHERE agent_id = ?${kind === 'net' ? " AND kind = 'signup'" : ''} AND ${guard} ON CONFLICT (hash, agent_id) DO UPDATE SET expires_at = excluded.expires_at`,
      )
      .bind(created, expires, agentId, ...guardBinds),
  );
}

/** An owner's Discord account, hashed: what owner bans and bot strikes (bot-strikes.ts) follow, past the owner row. */
export const ownerBanHash = async (relay: Relay, discordUserId: string) => hmac(relay.config.hashKey, `owner:${discordUserId}`);

/** An owner ban that never ends. */
const FOR_GOOD = '9999-12-31T23:59:59.999Z';

/** A ban never gets shorter: a later one only extends it. */
async function ownerBan(relay: Relay, agentId: string, discordUserId: string, expiresAt: string, guard: string, guardBinds: unknown[]): Promise<Stmt> {
  return relay.db
    .prepare(
      `INSERT INTO banned_origins (hash, kind, agent_id, created_at, expires_at) SELECT ?, 'owner', ?, ?, ? WHERE ${guard} ON CONFLICT (hash, agent_id) DO UPDATE SET expires_at = MAX(expires_at, excluded.expires_at)`,
    )
    .bind(await ownerBanHash(relay, discordUserId), agentId, iso(relay.now()), expiresAt, ...guardBinds);
}

/** The record that bars a banned agent's owner (by Discord account) from claiming or registering agents while the ban runs. */
export function banOwnerStmt(relay: Relay, agentId: string, discordUserId: string, guard: string, ...guardBinds: unknown[]): Promise<Stmt> {
  return ownerBan(relay, agentId, discordUserId, iso(new Date(relay.now().getTime() + LIMITS.bannedOriginDays * DAY_MS)), guard, guardBinds);
}

/** The same bar, for good: the owner whose agent's bot kept posting outside the relay (bot-strikes.ts). */
export function banOwnerForGoodStmt(relay: Relay, agentId: string, discordUserId: string): Promise<Stmt> {
  return ownerBan(relay, agentId, discordUserId, FOR_GOOD, '1', []);
}

export async function assertOwnerNotBarred(relay: Relay, discordUserId: string): Promise<void> {
  const barred = await relay.db
    .prepare("SELECT 1 AS x FROM banned_origins WHERE hash = ? AND kind = 'owner' AND expires_at > ? LIMIT 1")
    .bind(await ownerBanHash(relay, discordUserId), iso(relay.now()))
    .first();
  if (barred) throw forbidden('This account is banned from claiming or registering agents. Contact the relay admins if you think that is a mistake.');
}

/** Reinstating an agent lifts the ban record on its addresses. */
export function liftOriginBanStmt(relay: Relay, agentId: string, guard: string, ...guardBinds: unknown[]): Stmt {
  return relay.db.prepare(`DELETE FROM banned_origins WHERE agent_id = ? AND ${guard}`).bind(agentId, ...guardBinds);
}

export interface RevealedOrigin {
  kind: 'signup' | 'use';
  ip: string;
  asn: number | null;
  network: string | null;
  country: string | null;
  seen_at: string;
  purge_after: string;
}

/** The raw addresses still within their retention, opened. Callers audit the reveal first. */
export async function revealRawIps(relay: Relay, agentId: string): Promise<RevealedOrigin[]> {
  const { results } = await relay.db
    .prepare(
      'SELECT kind, asn, as_org, country, ip_sealed, ip_purge_after, seen_at FROM agent_origins WHERE agent_id = ? AND ip_sealed IS NOT NULL AND ip_purge_after > ? ORDER BY seen_at DESC, id DESC',
    )
    .bind(agentId, iso(relay.now()))
    .all<{
      kind: 'signup' | 'use';
      asn: number | null;
      as_org: string | null;
      country: string | null;
      ip_sealed: string;
      ip_purge_after: string;
      seen_at: string;
    }>();
  return Promise.all(
    results.map(async (r) => ({
      kind: r.kind,
      ip: await relay.secrets.open(r.ip_sealed, originAad(agentId)),
      asn: r.asn,
      network: r.as_org,
      country: r.country,
      seen_at: r.seen_at,
      purge_after: r.ip_purge_after,
    })),
  );
}
