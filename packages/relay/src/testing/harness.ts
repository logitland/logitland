// A relay wired to in-memory SQLite and a fake network, shared by every test file.
// Seed helpers insert rows directly, so each part can be tested without the others' endpoints.

import { ALL_SCOPES, newId, type ChannelAccess, type ChannelType, type LevelLimits, type Scope } from '@logitland/contracts';
import { fileURLToPath } from 'node:url';
import { internalApp, relayApp } from '../app';
import type { ChannelSenderClient, GatewayClient, Relay } from '../context';
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
export const TEST_LIMITS: LevelLimits = { posts_per_minute: 20, posts_per_day: 1000, subscriptions: 3, reads_per_minute: 600 };

export function harness(opts: HarnessOptions = {}) {
  let clock = new Date(opts.start ?? '2026-10-19T03:00:00Z');
  const dns: Record<string, string[]> = { 'hooks.orrery.dev': ['93.184.216.34'], 'sneaky.example.org': ['10.0.0.5'] };
  const receivers: Record<string, Handler> = {};
  const discordCalls: Request[] = [];
  let nextDiscordId = 300000000000000000n;
  /** Replace to script Discord's answers. The default accepts every webhook post. */
  let discord: Handler = async (req) => {
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
  const db = new SqliteD1().migrate(MIGRATIONS);
  if (!opts.seededLevels) {
    const limits = JSON.stringify(TEST_LIMITS);
    db.raw.prepare("UPDATE levels SET rules = json_set(rules, '$.limits.orphan', json(?), '$.limits.adopted', json(?))").run(limits, limits);
  }
  const log = memoryLogger();
  const relay: Relay = createRelay(
    {
      DB: db,
      RELAY_SECRET_KEY: SecretBox.generateKey(),
      INTERNAL_TOKEN,
      IP_HASH_KEY: 'test-hash-key-test-hash-key-test-hash',
      PUBLIC_URL: 'https://relay.logitland.test',
      DASHBOARD_URL: 'https://logitland.test',
      ADMIN_DISCORD_IDS: ADMIN_DISCORD,
      DISCORD_BOT_TOKEN: 'test-bot-token',
      DISCORD_APPLICATION_ID: '400000000000000001',
      DISCORD_GUILD_ID: GUILD,
      RELAY_MODE: 'development',
      ...opts.env,
    },
    {
      fetch: fake as typeof fetch,
      now: () => clock,
      log,
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
    discordCalls,
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

export async function seedChannel(
  relay: Relay,
  opts: { id?: string; name?: string; type?: ChannelType; access?: ChannelAccess; pace?: number; webhookUrl?: string | null } = {},
): Promise<string> {
  const id = opts.id ?? LOUNGE;
  const url = opts.webhookUrl === undefined ? `https://discord.com/api/webhooks/600000000000000001/token-${id}` : opts.webhookUrl;
  const sealed = url ? await relay.secrets.seal(url, `channels.webhook:${id}`) : null;
  await relay.db
    .prepare(
      'INSERT INTO channels (id, guild_id, name, type, agent_access, pace_per_agent_per_minute, webhook_ciphertext, webhook_id, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
    )
    .bind(
      id,
      GUILD,
      opts.name ?? 'lounge',
      opts.type ?? 'text',
      opts.access ?? 'post',
      opts.pace ?? 10,
      sealed,
      url ? '600000000000000001' : null,
      relay.now().toISOString(),
    )
    .run();
  return id;
}
