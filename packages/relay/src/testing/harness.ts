// A relay wired to in-memory SQLite and a fake network, shared by every test file.
// Seed helpers insert rows directly, so each part can be tested without the others' endpoints.

import { ALL_SCOPES, newId, type AgentTier, type ChannelAccess, type ChannelType, type Scope } from '@logitland/contracts';
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
  fallbackModerator?: Moderator | null;
  sender?: ChannelSenderClient | null;
  gateway?: GatewayClient | null;
  start?: string;
  /** Extra or replacement bindings, e.g. DISCORD_PUBLIC_KEY or MODERATION_OUTAGE. */
  env?: Partial<RelayBindings>;
}

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
      DISCORD_CONSENT_ROLE_ID: '500000000000000001',
      RELAY_MODE: 'development',
      ...opts.env,
    },
    {
      fetch: fake as typeof fetch,
      now: () => clock,
      log,
      ...(opts.moderator ? { moderator: opts.moderator } : {}),
      ...(opts.fallbackModerator !== undefined ? { fallbackModerator: opts.fallbackModerator } : {}),
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
    /** Public app: /v1, /public, /discord. */
    call: request(publicApp),
    /** Internal app, with the dashboard token already set. Pass x-logitland-owner yourself. */
    internal: (method: string, path: string, body?: unknown, headers: Record<string, string> = {}) =>
      request(internal)(method, path, body, { 'x-logitland-internal': INTERNAL_TOKEN, ...headers }),
    as: (key: string) => ({ authorization: `Bearer ${key}` }),
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

export async function seedAgent(
  relay: Relay,
  opts: {
    name?: string;
    tier?: AgentTier;
    ownerId?: string | null;
    status?: 'active' | 'off' | 'suspended' | 'banned';
    scopes?: Scope[];
    probationUntil?: string | null;
  } = {},
): Promise<{ id: string; key: string; keyId: string; name: string }> {
  const id = newId('agent');
  const name = opts.name ?? `Agent-${id.slice(-5)}`;
  const now = relay.now().toISOString();
  const scopes = JSON.stringify(opts.scopes ?? ALL_SCOPES);
  await relay.db
    .prepare(
      'INSERT INTO agents (id, owner_id, name, name_key, description, avatar_url, tier, status, created_via, scopes, probation_until, created_at, updated_at) VALUES (?, ?, ?, ?, NULL, NULL, ?, ?, ?, ?, ?, ?, ?)',
    )
    .bind(
      id,
      opts.ownerId ?? null,
      name,
      nameKey(name),
      opts.tier ?? 'claimed',
      opts.status ?? 'active',
      opts.ownerId ? 'dashboard' : 'signup',
      scopes,
      opts.probationUntil ?? null,
      now,
      now,
    )
    .run();
  const key = randomToken('lk_');
  const keyId = newId('key');
  await relay.db
    .prepare('INSERT INTO api_keys (id, agent_id, hash, scopes, created_at) VALUES (?, ?, ?, ?, ?)')
    .bind(keyId, id, await sha256(key), scopes, now)
    .run();
  return { id, key, keyId, name };
}

export async function seedChannel(
  relay: Relay,
  opts: { id?: string; name?: string; type?: ChannelType; access?: ChannelAccess; pace?: number; publicMirror?: boolean; webhookUrl?: string | null } = {},
): Promise<string> {
  const id = opts.id ?? LOUNGE;
  const url = opts.webhookUrl === undefined ? `https://discord.com/api/webhooks/600000000000000001/token-${id}` : opts.webhookUrl;
  const sealed = url ? await relay.secrets.seal(url, `channels.webhook:${id}`) : null;
  await relay.db
    .prepare(
      'INSERT INTO channels (id, guild_id, name, type, agent_access, pace_per_agent_per_minute, public_mirror, webhook_ciphertext, webhook_id, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    )
    .bind(
      id,
      GUILD,
      opts.name ?? 'lounge',
      opts.type ?? 'text',
      opts.access ?? 'post',
      opts.pace ?? 10,
      opts.publicMirror ? 1 : 0,
      sealed,
      url ? '600000000000000001' : null,
      relay.now().toISOString(),
    )
    .run();
  return id;
}
