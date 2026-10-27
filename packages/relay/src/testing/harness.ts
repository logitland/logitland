// A relay wired to in-memory SQLite and a fake network, shared by every test file.
// Seed helpers insert rows directly, so each part can be tested without the others' endpoints.

import { ALL_SCOPES, newId, type ChannelType, type LevelLimits, type Scope } from '@logitland/contracts';
import { Permission, type Overwrite } from '@logitland/discord';
import { fileURLToPath } from 'node:url';
import { internalApp, relayApp } from '../app';
import type { AvatarBucket, ChannelSenderClient, Db, GatewayClient, Relay, SocketOpener } from '../context';
import { SecretBox, randomToken, sha256 } from '../crypto';
import { createRelay } from '../index';
import type { RelayBindings } from '../config';
import { nameKey } from '../services/names';
import { memoryLogger } from '../log';
import type { Moderator } from '../services/moderation/classifier';
import { SqliteD1 } from './sqlite-d1';

export const MIGRATIONS = fileURLToPath(new URL('../../migrations', import.meta.url).href);
export const GUILD = '100000000000000001';
export const LOUNGE = '110000000000000001';
export const BENCH = '110000000000000002';
export const FORUM = '110000000000000003';
export const ADMIN_DISCORD = '200000000000000099';
export const INTERNAL_TOKEN = 'test-internal-token';

export type Handler = (req: Request) => Response | Promise<Response>;

/** GET /applications/@me for an application owned by a Developer team with these members, all accepted. */
export const application = (team: string[]) => ({
  id: '400000000000000001',
  name: 'Logitland',
  flags: 1 << 19,
  owner: { id: '700000000000000001', username: 'team700000000000000001' },
  team: {
    id: '700000000000000001',
    name: 'Logitland',
    owner_user_id: team[0],
    members: team.map((id) => ({ user: { id, username: `dev-${id.slice(-4)}` }, membership_state: 2, role: 'admin' })),
  },
});

export interface HarnessOptions {
  moderator?: Moderator;
  sender?: ChannelSenderClient | null;
  gateway?: GatewayClient | null;
  start?: string;
  /** Extra or replacement bindings, e.g. DISCORD_PUBLIC_KEY or MODERATION_OUTAGE. */
  env?: Partial<RelayBindings>;
  /** Keep the migration's placeholder level limits. By default every level gets TEST_LIMITS, so tests about other things don't trip them. */
  seededLevels?: boolean;
}

/** The limits every level has in tests unless `seededLevels` is set. */
export const TEST_LIMITS: LevelLimits = { posts_per_minute: 20, posts_per_day: 1000, subscriptions: 3, reads_per_minute: 600, private_conversations: 2 };

/** Bytes from text (one byte per character) and numbers. */
const bytes = (...parts: (string | number[])[]) => new Uint8Array(parts.flatMap((p) => (typeof p === 'string' ? [...p].map((c) => c.charCodeAt(0)) : p)));
const u16le = (n: number) => [n & 255, n >> 8];
const u16be = (n: number) => [n >> 8, n & 255];
const u24le = (n: number) => [n & 255, (n >> 8) & 255, n >> 16];
const u32be = (n: number) => [n >>> 24, (n >> 16) & 255, (n >> 8) & 255, n & 255];
const u32le = (n: number) => u32be(n).reverse();

export type TestImageFormat = 'png' | 'jpg' | 'gif' | 'webp' | 'webp-lossy' | 'webp-lossless';

/**
 * The header of an image in `format` claiming `width` × `height`, then `tail`: enough for the relay's checks, which read
 * only headers. A different tail makes a different file. `webp` is the extended (VP8X) kind.
 */
export function testImage(format: TestImageFormat, width = 128, height = 128, tail = ''): Uint8Array<ArrayBuffer> {
  const riff = (chunk: string, body: number[]) => bytes('RIFF', u32le(4 + 8 + body.length), 'WEBP', chunk, u32le(body.length), body, tail);
  switch (format) {
    case 'png':
      return bytes([0x89], 'PNG\r\n\x1a\n', u32be(13), 'IHDR', u32be(width), u32be(height), [8, 6, 0, 0, 0], u32be(0), tail);
    case 'jpg':
      return bytes(
        [0xff, 0xd8],
        [0xff, 0xe0],
        u16be(16),
        'JFIF\0',
        [1, 1, 0, 0, 1, 0, 1, 0, 0],
        [0xff, 0xc0],
        u16be(17),
        [8],
        u16be(height),
        u16be(width),
        [3],
        tail,
      );
    case 'gif':
      return bytes('GIF89a', u16le(width), u16le(height), [0, 0, 0], tail);
    case 'webp':
      return riff('VP8X', [0, 0, 0, 0, ...u24le(width - 1), ...u24le(height - 1)]);
    case 'webp-lossy':
      return riff('VP8 ', [0, 0, 0, 0x9d, 0x01, 0x2a, ...u16le(width), ...u16le(height)]);
    case 'webp-lossless': {
      const bits = (width - 1) | ((height - 1) << 14);
      return riff('VP8L', [0x2f, ...u32le(bits)]);
    }
  }
}

export function harness(opts: HarnessOptions = {}) {
  let clock = new Date(opts.start ?? '2026-10-19T03:00:00Z');
  const dns: Record<string, string[]> = {
    'hooks.orrery.dev': ['93.184.216.34'],
    'sneaky.example.org': ['10.0.0.5'],
    'cdn.example.com': ['93.184.216.35'],
  };
  /** cdn.example.com serves a 128×128 PNG at every path, different per path; replace it to serve something else. */
  const receivers: Record<string, Handler> = {
    'cdn.example.com': (req) => new Response(testImage('png', 128, 128, new URL(req.url).pathname), { headers: { 'content-type': 'image/png' } }),
  };
  /** The avatar bucket's objects, by key. */
  const avatars = new Map<string, { bytes: Uint8Array<ArrayBuffer>; contentType: string }>();
  const bucket: AvatarBucket = {
    get: async (key) => {
      const object = avatars.get(key);
      return object ? { body: new Blob([object.bytes]).stream(), httpMetadata: { contentType: object.contentType } } : null;
    },
    put: async (key, value, { httpMetadata }) => void avatars.set(key, { bytes: value, contentType: httpMetadata.contentType }),
    delete: async (key) => void avatars.delete(key),
  };
  const discordCalls: Request[] = [];
  let nextDiscordId = 300000000000000000n;
  /** Replace to script Discord's answers. The default accepts every webhook post, and ADMIN_DISCORD is the bot's Developer team. */
  let discord: Handler = async (req) => {
    if (new URL(req.url).pathname.endsWith('/applications/@me')) return Response.json(application([ADMIN_DISCORD]));
    const body =
      req.method === 'POST'
        ? await req
            .clone()
            .json()
            .catch(() => ({}))
        : {};
    nextDiscordId += 1n;
    return Response.json({
      id: String(nextDiscordId),
      channel_id: LOUNGE,
      content: (body as { content?: string }).content ?? '',
      timestamp: clock.toISOString(),
      edited_timestamp: null,
    });
  };
  const fake = async (input: RequestInfo | URL, init?: RequestInit) => {
    const req = new Request(input, init);
    const url = new URL(req.url);
    if (url.hostname === 'cloudflare-dns.com') {
      const name = url.searchParams.get('name')!;
      const type = url.searchParams.get('type');
      const answers = (dns[name] ?? [])
        .filter((a) => (type === 'AAAA' ? a.includes(':') : !a.includes(':')))
        .map((data) => ({ type: type === 'AAAA' ? 28 : 1, data }));
      return Response.json({ Status: 0, Answer: answers });
    }
    if (url.hostname === 'discord.com') {
      discordCalls.push(req.clone());
      return discord(req);
    }
    const h = receivers[url.host];
    if (!h) throw new TypeError(`no route to ${url.host}`);
    return h(req);
  };
  /** The tokens of bots the relay connected to the Gateway once (services/bots.ts). Every connection reaches READY. */
  const identified: string[] = [];
  const openSocket: SocketOpener = async (_url, events) => {
    queueMicrotask(() => events.message(JSON.stringify({ op: 10, d: { heartbeat_interval: 41_250 } })));
    return {
      send: (data) => {
        const frame = JSON.parse(data) as { op: number; d: { token: string } };
        if (frame.op !== 2) return;
        identified.push(frame.d.token);
        queueMicrotask(() => events.message(JSON.stringify({ op: 0, t: 'READY', s: 1, d: {} })));
      },
      close: () => {},
    };
  };
  const db = new SqliteD1().migrate(MIGRATIONS);
  if (!opts.seededLevels) {
    const limits = JSON.stringify(TEST_LIMITS);
    db.raw.prepare("UPDATE levels SET rules = json_set(rules, '$.limits', json(?))").run(limits);
  }
  // The server's @everyone role (its ID is the guild's), as the Gateway would report it.
  db.raw
    .prepare("INSERT INTO guild_roles (id, guild_id, name, permissions, updated_at) VALUES (?, ?, '@everyone', ?, ?)")
    .run(GUILD, GUILD, String(AGENT_BASE), clock.toISOString());
  // The Developer team, as if the relay had just asked Discord, so tests that script Discord for other things keep an admin.
  db.raw.prepare("INSERT INTO discord_lookups (key, value, fetched_at) VALUES ('team', ?, ?)").run(JSON.stringify([ADMIN_DISCORD]), clock.toISOString());
  const log = memoryLogger();
  const relay: Relay = createRelay(
    {
      DB: db,
      RELAY_SECRET_KEY: SecretBox.generateKey(),
      INTERNAL_TOKEN,
      IP_HASH_KEY: 'test-hash-key-test-hash-key-test-hash',
      PUBLIC_URL: 'https://relay.logitland.test',
      DASHBOARD_URL: 'https://logitland.test',
      DISCORD_BOT_TOKEN: 'test-bot-token',
      DISCORD_APPLICATION_ID: '400000000000000001',
      DISCORD_GUILD_ID: GUILD,
      RELAY_MODE: 'development',
      AVATARS: bucket,
      ...opts.env,
    },
    {
      fetch: fake as typeof fetch,
      now: () => clock,
      log,
      openSocket,
      ...(opts.moderator ? { moderator: opts.moderator } : {}),
      ...(opts.sender !== undefined ? { sender: opts.sender } : {}),
      ...(opts.gateway !== undefined ? { gateway: opts.gateway } : {}),
    },
  );
  const publicApp = relayApp(relay);
  const internal = internalApp(relay);

  const waitUntil: Promise<unknown>[] = [];
  /** An execution context whose waitUntil work tests can await with `settle()`. */
  const ctx = { waitUntil: (p: Promise<unknown>) => void waitUntil.push(p), passThroughOnException: () => {}, props: {} };
  const request =
    (app: typeof publicApp) =>
    (method: string, path: string, body?: unknown, headers: Record<string, string> = {}) =>
      app.request(
        path,
        {
          method,
          headers: { 'content-type': 'application/json', 'cf-connecting-ip': '203.0.113.7', ...headers },
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        },
        undefined,
        ctx as never,
      );

  return {
    relay,
    db,
    log,
    receivers,
    dns,
    avatars,
    discordCalls,
    identified,
    /** Public app: /v1, /agent, /oauth2, the docs. */
    call: request(publicApp),
    /** A form-encoded POST to the public app, as /oauth2/token and /oauth2/revoke take. */
    form: (path: string, fields: Record<string, string>) =>
      publicApp.request(
        path,
        {
          method: 'POST',
          headers: { 'content-type': 'application/x-www-form-urlencoded', 'cf-connecting-ip': '203.0.113.7' },
          body: new URLSearchParams(fields).toString(),
        },
        undefined,
        ctx as never,
      ),
    /** Internal app, with the dashboard token already set. Pass x-logitland-owner yourself. */
    internal: (method: string, path: string, body?: unknown, headers: Record<string, string> = {}) =>
      request(internal)(method, path, body, { 'x-logitland-internal': INTERNAL_TOKEN, ...headers }),
    as: (token: string) => ({ authorization: `Bearer ${token}` }),
    /** Waits for everything handed to waitUntil so far. */
    async settle() {
      while (waitUntil.length) await Promise.allSettled(waitUntil.splice(0));
    },
    setDiscord(h: Handler) {
      discord = h;
    },
    advance(ms: number) {
      clock = new Date(clock.getTime() + ms);
    },
    now: () => clock,
  };
}

export type Harness = ReturnType<typeof harness>;

export async function seedOwner(relay: Relay, discordUserId = '200000000000000001', username = 'luna-test'): Promise<{ id: string; discord_user_id: string }> {
  const id = newId('owner');
  await relay.db
    .prepare('INSERT INTO owners (id, discord_user_id, username, created_at) VALUES (?, ?, ?, ?)')
    .bind(id, discordUserId, username, relay.now().toISOString())
    .run();
  return { id, discord_user_id: discordUserId };
}

/** How long a seeded access token lasts: long enough that tests moving the clock by days don't have to exchange again. */
const SEEDED_TOKEN_MS = 365 * 86_400_000;

/**
 * An agent with an access token, inserted directly (no registration, no proof of work). Level 1 by default, so it isn't on
 * probation; pass `level: 0` for probation. `kind: 'reader'` makes the web app's read-only client.
 */
export async function seedAgent(
  relay: Relay,
  opts: {
    name?: string;
    level?: number;
    xp?: number;
    kind?: 'agent' | 'reader';
    ownerId?: string | null;
    status?: 'active' | 'off' | 'suspended' | 'banned';
    scopes?: Scope[];
    avatarUrl?: string | null;
  } = {},
): Promise<{ id: string; token: string; tokenId: string; name: string }> {
  const id = newId('agent');
  const name = opts.name ?? `Agent-${id.slice(-5)}`;
  const now = relay.now();
  const scopes = JSON.stringify(opts.scopes ?? ALL_SCOPES);
  await relay.db
    .prepare(
      'INSERT INTO agents (id, kind, owner_id, adopted_at, name, name_key, avatar_url, level, xp, status, scopes, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    )
    .bind(
      id,
      opts.kind ?? 'agent',
      opts.ownerId ?? null,
      opts.ownerId ? now.toISOString() : null,
      name,
      nameKey(name),
      opts.avatarUrl ?? null,
      opts.level ?? 1,
      opts.xp ?? 0,
      opts.status ?? 'active',
      scopes,
      now.toISOString(),
      now.toISOString(),
    )
    .run();
  const token = randomToken('lat_');
  const tokenId = newId('token');
  await relay.db
    .prepare('INSERT INTO access_tokens (id, agent_id, hash, scopes, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?)')
    .bind(tokenId, id, await sha256(token), scopes, now.toISOString(), new Date(now.getTime() + SEEDED_TOKEN_MS).toISOString())
    .run();
  return { id, token, tokenId, name };
}

/**
 * What agents may do in a seeded channel, as shorthand for Discord overwrites on @everyone (whose base role, seeded by the
 * harness, allows everything agents use): `post`, `read_only` (no posting, threads or replies) or `off` (not even view it).
 */
export type SeedAccess = 'post' | 'read_only' | 'off';

const P = Permission;
const POSTING = P.SEND_MESSAGES | P.SEND_MESSAGES_IN_THREADS | P.CREATE_PUBLIC_THREADS;
/** @everyone's base permissions in tests: view, read history, post, use threads and post links. */
export const AGENT_BASE = P.VIEW_CHANNEL | P.READ_MESSAGE_HISTORY | POSTING | P.EMBED_LINKS;

const overwritesFor = (access: SeedAccess): Overwrite[] =>
  access === 'post' ? [] : [{ id: GUILD, type: 0, allow: '0', deny: String(access === 'off' ? P.VIEW_CHANNEL : POSTING) }];

/** Opens or closes a seeded channel to agents, as an admin changing its @everyone overwrite in Discord would. */
export async function setAccess(db: Db, channelId: string, access: SeedAccess): Promise<void> {
  await db
    .prepare('UPDATE channels SET overwrites = ? WHERE id = ?')
    .bind(JSON.stringify(overwritesFor(access)), channelId)
    .run();
}

export async function seedChannel(
  relay: Relay,
  opts: {
    id?: string;
    name?: string;
    type?: ChannelType;
    access?: SeedAccess;
    /** Overwrites as Discord stores them; replaces `access`. */
    overwrites?: Overwrite[];
    slowmode?: number;
    webhookUrl?: string | null;
  } = {},
): Promise<string> {
  const id = opts.id ?? LOUNGE;
  const url = opts.webhookUrl === undefined ? `https://discord.com/api/webhooks/600000000000000001/token-${id}` : opts.webhookUrl;
  const sealed = url ? await relay.secrets.seal(url, `channels.webhook:${id}`) : null;
  await relay.db
    .prepare(
      'INSERT INTO channels (id, guild_id, name, type, overwrites, slowmode_seconds, webhook_ciphertext, webhook_id, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
    )
    .bind(
      id,
      GUILD,
      opts.name ?? 'lounge',
      opts.type ?? 'text',
      JSON.stringify(opts.overwrites ?? overwritesFor(opts.access ?? 'post')),
      opts.slowmode ?? 0,
      sealed,
      url ? '600000000000000001' : null,
      relay.now().toISOString(),
    )
    .run();
  return id;
}
