// The whole system on workerd, against a fake Discord: the backend Worker started with wrangler's own API, a temporary
// D1 database with the real migrations, and a fake Discord (REST, Gateway and interactions) on loopback. Nothing here
// touches the network beyond 127.0.0.1; see outbound.ts.

import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SecretBox } from '@logitland/relay';
import { DEV, DiscordFake, seedDevCommunity, type FakeOptions, type SeededCommunity } from '../../../../packages/discord-fake/src/index.ts';
import { outbound, type Outbound } from './outbound.ts';

/** Set by vitest.e2e.config.ts, so `pnpm test` (which also finds these files) skips them. */
export const E2E = process.env.LOGITLAND_E2E === '1';

const BACKEND = fileURLToPath(new URL('../..', import.meta.url));
const MIGRATIONS = fileURLToPath(new URL('../../../../packages/relay/migrations', import.meta.url));

/** The relay's D1 binding as the Worker sees it, reached from Node through the running workerd. */
export interface Db {
  prepare(sql: string): {
    bind(...values: unknown[]): ReturnType<Db['prepare']>;
    first<T = Record<string, unknown>>(): Promise<T | null>;
    all<T = Record<string, unknown>>(): Promise<{ results: T[] }>;
    run(): Promise<{ meta: { changes: number } }>;
  };
  batch(statements: unknown[]): Promise<unknown[]>;
}

export interface Reply<T = any> {
  status: number;
  headers: Headers;
  body: T;
}

export interface Stack {
  fake: DiscordFake;
  community: SeededCommunity;
  /** The Worker's origin, e.g. http://localhost:51234 */
  base: string;
  db: Db;
  /** The Miniflare behind the Worker, for reaching bindings and named entrypoints. */
  /** Restarts the Worker's runtime the way a deploy does: every Durable Object loses its memory and its sockets, storage stays. */
  restart(): Promise<void>;
  outbound: Outbound;
  /** The fake's channel IDs, by name. */
  channels: { lounge: string; forum: string; media: string; announcements: string };
  secretKey: string;
  internalToken: string;
  /** A request to the Worker's public entrypoint. */
  call(method: string, path: string, opts?: { key?: string; body?: unknown; headers?: Record<string, string> }): Promise<Reply>;
  /** The dashboard's API (the InternalApi entrypoint), as the frontend calls it through its service binding. */
  dashboard(method: string, path: string, opts?: { owner?: string; body?: unknown }): Promise<Reply>;
  /** Signs in the Discord admin from the seeded community and returns their owner ID. */
  adminOwner(): Promise<string>;
  /** What cron does every minute. */
  cron(): Promise<Reply<string>>;
  /** Everything the Worker logged, as `message` lines. */
  logs: string[];
  sql<T = Record<string, unknown>>(query: string, ...binds: unknown[]): Promise<T[]>;
  signup(name: string, ip: string): Promise<{ agent_id: string; key: string }>;
  dispose(): Promise<void>;
}

export interface StackOptions {
  /** Extra or replacement bindings (RELAY_SECRET_KEY, INTERNAL_TOKEN and DISCORD_BOT_TOKEN are bound as secrets). A value of null removes a default. */
  env?: Record<string, string | null>;
  fake?: FakeOptions;
  /** Seed the relay's channels with webhooks the fake knows (default true). */
  channels?: boolean;
  /** Apply the migrations (default true). */
  migrate?: boolean;
}

/** Finds a nonce for real, the way an agent would. */
export function solve(challenge: string, difficulty: number): string {
  for (let n = 0; ; n++) {
    const digest = createHash('sha256').update(`${challenge}:${n}`).digest();
    let bits = 0;
    for (const byte of digest) {
      if (byte === 0) bits += 8;
      else {
        bits += Math.clz32(byte) - 24;
        break;
      }
    }
    if (bits >= difficulty) return String(n);
  }
}

export async function eventually<T>(
  check: () => T | Promise<T>,
  opts: { timeoutMs?: number; intervalMs?: number; what?: string } = {},
): Promise<NonNullable<T>> {
  const deadline = Date.now() + (opts.timeoutMs ?? 15_000);
  let last: unknown;
  for (;;) {
    try {
      const value = await check();
      if (value) return value as NonNullable<T>;
    } catch (err) {
      last = err;
    }
    if (Date.now() > deadline)
      throw new Error(`Timed out waiting for ${opts.what ?? 'the expected state'}${last ? `: ${last instanceof Error ? last.message : String(last)}` : ''}`);
    await new Promise((resolve) => setTimeout(resolve, opts.intervalMs ?? 50));
  }
}

export const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** A port nobody is using right now. */
async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as { port: number };
      server.close(() => resolve(port));
    });
  });
}

export async function startStack(options: StackOptions = {}): Promise<Stack> {
  // Quiet, offline wrangler, with its own dev registry so a developer's running `wrangler dev` sessions are left alone.
  const scratch = mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), 'logitland-e2e-'));
  process.env.WRANGLER_LOG ??= 'error';
  process.env.WRANGLER_SEND_METRICS = 'false';
  process.env.WRANGLER_REGISTRY_PATH = join(scratch, 'registry');
  const { unstable_startWorker, unstable_splitSqlQuery } = await import('wrangler');

  const fake = await DiscordFake.start(options.fake);
  // Discord allows about five posts per webhook every two seconds; the scenarios that care set it back.
  fake.setRateLimits({ webhook: { limit: 1000, windowMs: 1000 } });
  const community = seedDevCommunity(fake);
  const out = outbound(fake);
  const logs: string[] = [];
  const secretKey = SecretBox.generateKey();
  const internalToken = `e2e-internal-${Math.random().toString(36).slice(2)}`;

  // The Worker knows its own address (PUBLIC_URL), as it would in production, so the setup checklist can compare it with Discord's.
  const port = await freePort();
  const plain: Record<string, string | null> = {
    PUBLIC_URL: `http://localhost:${port}`,
    RELAY_MODE: 'development',
    DISCORD_API_BASE: fake.apiBase,
    DISCORD_APPLICATION_ID: fake.application.id,
    DISCORD_GUILD_ID: community.guildId,
    DISCORD_CONSENT_ROLE_ID: community.consentRoleId,
    DISCORD_PUBLIC_KEY: fake.publicKey,
    ADMIN_DISCORD_IDS: community.adminId,
  };
  const secret: Record<string, string | null> = { RELAY_SECRET_KEY: secretKey, INTERNAL_TOKEN: internalToken, DISCORD_BOT_TOKEN: fake.botToken };
  // Options can replace any binding; the ones that are secrets in production are bound as secrets.
  for (const [name, value] of Object.entries(options.env ?? {})) (name in secret ? secret : plain)[name] = value;
  const bindings: Record<string, Record<string, unknown>> = {
    // The dashboard's API is a named entrypoint nobody can reach from outside; a binding to the Worker itself lets the suite play the dashboard.
    DASHBOARD: { type: 'service', service: 'logitland-backend-dev', entrypoint: 'InternalApi' },
  };
  for (const [name, value] of Object.entries(secret)) if (value !== null) bindings[name] = { type: 'secret_text', value };
  for (const [name, value] of Object.entries(plain)) if (value !== null) bindings[name] = { type: 'plain_text', value };

  const persist = join(scratch, 'state');
  const worker = await unstable_startWorker({
    config: join(BACKEND, 'wrangler.jsonc'),
    // A named env file that doesn't exist: wrangler then reads neither .dev.vars nor .env, so only the bindings above apply.
    envFiles: [join(scratch, 'no.env')],
    bindings,
    dev: {
      persist,
      server: { port },
      inspector: false,
      testScheduled: true,
      outboundService: out.handler,
      structuredLogsHandler: (log: { message: string }) => logs.push(log.message),
    },
  } as Parameters<typeof unstable_startWorker>[0]);
  const base = String(await worker.url).replace(/\/$/, '');

  const dispose = async () => {
    out.closeAll();
    await worker.dispose().catch(() => {});
    await fake.close();
    rmSync(scratch, { recursive: true, force: true });
  };

  try {
    // The Miniflare behind the Worker exists once the first request has gone through it.
    await fetch(`${base}/`);
    const mf = (worker.raw.runtimes[0] as unknown as { mf?: { getBindings<T>(): Promise<T>; getD1Database(name: string): Promise<Db> } }).mf;
    if (!mf) throw new Error('wrangler did not expose its Miniflare instance');
    let current = await mf.getD1Database('DB');
    // One handle for the whole run, which follows the runtime across restarts.
    const db: Db = { prepare: (sql) => current.prepare(sql), batch: (statements) => current.batch(statements) };

    if (options.migrate !== false) {
      for (const file of readdirSync(MIGRATIONS)
        .filter((f) => f.endsWith('.sql'))
        .sort()) {
        const statements = unstable_splitSqlQuery(readFileSync(join(MIGRATIONS, file), 'utf8'));
        await db.batch(statements.map((s: string) => db.prepare(s)));
      }
    }

    const channels = { lounge: DEV.channels.lounge, forum: DEV.channels.labBench, media: DEV.channels.showAndTell, announcements: DEV.channels.announcements };
    if (options.channels !== false && options.migrate !== false) {
      const box = new SecretBox({ id: 'k1', key: secretKey });
      const now = new Date().toISOString();
      // The community's admin agreed to the mirror before the suite starts, so what they write in the scenarios is kept like
      // any agreed person's. The visitor has not: their words are withheld until a scenario has them press the button.
      await db
        .prepare("INSERT INTO consents (discord_user_id, guild_id, method, notice_version, granted_at) VALUES (?, ?, 'button', 'e2e', ?)")
        .bind(community.adminId, community.guildId, new Date(Date.now() - 3_600_000).toISOString())
        .run();
      const rows = [
        { key: 'lounge', type: 'text', access: 'post', mirror: 1 },
        { key: 'labBench', type: 'forum', access: 'post_new_threads', mirror: 1 },
        { key: 'showAndTell', type: 'media', access: 'post_new_threads', mirror: 0 },
        { key: 'announcements', type: 'announcement', access: 'read_only', mirror: 1 },
      ] as const;
      for (const r of rows) {
        const c = community.channels.find((x) => x.key === r.key)!;
        await db
          .prepare(
            'INSERT INTO channels (id, guild_id, name, type, agent_access, pace_per_agent_per_minute, public_mirror, webhook_ciphertext, webhook_id, tags, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
          )
          .bind(
            c.id,
            community.guildId,
            c.name,
            r.type,
            r.access,
            60,
            r.mirror,
            await box.seal(c.webhook.url, `channels.webhook:${c.id}`),
            c.webhook.id,
            JSON.stringify((fake.world.channel(c.id).available_tags ?? []).map((t) => ({ id: t.id, name: t.name, moderated: t.moderated }))),
            now,
          )
          .run();
      }
    }

    fake.application.interactions_endpoint_url = `${base}/discord/interactions`;

    type Env = { DASHBOARD: { fetch(url: string, init?: RequestInit): Promise<Response> } };
    let env = await mf.getBindings<Env>();
    const parse = async (res: Response): Promise<Reply> => {
      const text = await res.text();
      let body: unknown = text;
      try {
        body = JSON.parse(text);
      } catch {
        // Not JSON (a Markdown page, say): keep the text.
      }
      return { status: res.status, headers: res.headers, body };
    };
    const dashboard: Stack['dashboard'] = async (method, path, opts = {}) => {
      const headers: Record<string, string> = { 'x-logitland-internal': internalToken };
      if (opts.owner) headers['x-logitland-owner'] = opts.owner;
      if (opts.body !== undefined) headers['content-type'] = 'application/json';
      return parse(
        await env.DASHBOARD.fetch(`https://relay.internal${path}`, {
          method,
          headers,
          ...(opts.body === undefined ? {} : { body: JSON.stringify(opts.body) }),
        }),
      );
    };
    let admin: string | undefined;
    let restarts = 0;

    const call: Stack['call'] = async (method, path, opts = {}) => {
      const headers: Record<string, string> = { ...opts.headers };
      if (opts.key) headers.authorization = `Bearer ${opts.key}`;
      if (opts.body !== undefined) headers['content-type'] = 'application/json';
      return parse(await fetch(`${base}${path}`, { method, headers, ...(opts.body === undefined ? {} : { body: JSON.stringify(opts.body) }) }));
    };

    return {
      fake,
      community,
      base,
      db,
      outbound: out,
      channels,
      secretKey,
      internalToken,
      call,
      dashboard,
      logs,
      async restart() {
        const reloaded = new Promise<void>((resolve) => worker.raw.once('reloadComplete', () => resolve()));
        // Any change to the configuration restarts the runtime.
        await worker.patchConfig({ bindings: { ...bindings, E2E_RESTARTS: { type: 'plain_text', value: String(++restarts) } } } as never);
        await reloaded;
        await eventually(async () => (await fetch(`${base}/`)).status === 200, { what: 'the Worker to answer after the restart' });
        const fresh = (worker.raw.runtimes[0] as unknown as { mf: typeof mf }).mf;
        current = await fresh.getD1Database('DB');
        env = await fresh.getBindings<Env>();
      },
      async adminOwner() {
        admin ??= (await dashboard('POST', '/internal/owners', { body: { discord_user_id: community.adminId, username: 'luna-admin' } })).body.owner.id;
        return admin!;
      },
      cron: () => call('GET', '/cdn-cgi/handler/scheduled?cron=*+*+*+*+*') as Promise<Reply<string>>,
      async sql(query, ...binds) {
        return (
          await db
            .prepare(query)
            .bind(...binds)
            .all()
        ).results as never;
      },
      async signup(name, ip) {
        const headers = { 'cf-connecting-ip': ip };
        const challenge = (await call('GET', '/v1/signup/challenge', { headers })).body;
        const res = await call('POST', '/v1/agents', {
          headers,
          body: { name, challenge: challenge.challenge, nonce: solve(challenge.challenge, challenge.difficulty) },
        });
        if (res.status !== 201) throw new Error(`Signup failed (${res.status}): ${JSON.stringify(res.body)}`);
        return { agent_id: res.body.agent_id, key: res.body.key.secret };
      },
      dispose,
    };
  } catch (err) {
    await dispose();
    throw err;
  }
}
