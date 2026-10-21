// A programmable fake Discord, served on 127.0.0.1: REST under /api/v10, the Gateway at /gateway and a control API
// under /_fake. Start one with `DiscordFake.start()`, seed it, point the relay at `apiBase`, and drive it from tests.

import { randomBytes } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { handleControl } from './control.ts';
import { Gateway, type GatewayOptions } from './gateway.ts';
import { snowflakeGenerator } from './ids.ts';
import { Interactions, type InteractionSpec, type InteractionResult } from './interactions.ts';
import {
  AppFlag,
  DiscordHttpError,
  errors,
  formBody,
  isForum,
  isThread,
  Permission,
  type Channel,
  type ChannelKind,
  type Guild,
  type Member,
  type Message,
  type Role,
  type User,
  type Webhook,
} from './model.ts';
import { routes, type Route } from './rest.ts';
import { World, type NewChannel } from './world.ts';

export interface FakeOptions {
  host?: string;
  /** 0 picks a free port. */
  port?: number;
  botToken?: string;
  applicationId?: string;
  botUsername?: string;
  /** Whether the Message Content intent is enabled in the Developer Portal: under 100 servers (default), 100+ servers, or off. */
  messageContent?: 'limited' | 'full' | 'off';
  /** An Ed25519 private key (PEM) to sign interactions with. Default: a new one. */
  interactionKeyPem?: string;
  now?: () => number;
  gateway?: Partial<GatewayOptions>;
  /** Refuse usernames with "clyde" or "discord" on webhook posts. Documented for Create Webhook; assumed for execution. Default true. */
  strictUsernames?: boolean;
}

export interface BucketSpec {
  limit: number;
  windowMs: number;
}

export interface RateLimitConfig {
  /** Answer 429 when a bucket is used up. Off by default: the headers are always sent, but nothing is refused. */
  enforce: boolean;
  webhook: BucketSpec;
  default: BucketSpec;
}

export type Behaviour =
  /** 429 with Retry-After and x-ratelimit-* headers; the request is not processed. */
  | { type: 'rate_limit'; retryAfter?: number; global?: boolean; scope?: 'user' | 'global' | 'shared' }
  /** An HTTP error with a JSON body; the request is not processed. */
  | { type: 'status'; status?: number; body?: unknown }
  /** Waits `ms`, before processing (default) or between processing and answering. */
  | { type: 'slow'; ms: number; phase?: 'before' | 'after' }
  /** Closes the connection with no answer: before processing (nothing happens) or after it (the change is made but unreported). */
  | { type: 'drop'; phase?: 'before' | 'after' };

export interface FailureMatch {
  /** A route name such as 'webhook.execute', a prefix with a trailing '*' ('webhook.*'), or a pattern. */
  route?: string | RegExp;
  method?: string;
  path?: string | RegExp;
  /** The channel the request is about (a webhook's channel for webhook routes). */
  channelId?: string;
  webhookId?: string;
}

export interface FailureRule {
  id: number;
  match: FailureMatch;
  behaviour: Behaviour;
  times: number;
  hits: number;
  remove(): void;
}

export interface RecordedRequest {
  n: number;
  at: string;
  route: string;
  method: string;
  /** Path after /api/v10, without the query. */
  path: string;
  query: Record<string, string>;
  /** Header names are lower case. */
  headers: Record<string, string>;
  /** The parsed JSON body, or the raw text when it isn't JSON. */
  body: unknown;
  /** 0 when the connection was dropped. */
  status: number;
  reply: unknown;
  /** The failure behaviour that was applied, if any. */
  injected: Behaviour['type'] | null;
  params: Record<string, string>;
}

interface CompiledRoute {
  route: Route;
  regex: RegExp;
  keys: string[];
}

const compile = (route: Route): CompiledRoute => {
  const keys: string[] = [];
  const pattern = route.path.replace(/:([a-z]+)/g, (_m, key: string) => {
    keys.push(key);
    return '([^/]+)';
  });
  return { route, regex: new RegExp(`^${pattern}$`), keys };
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function readBody(req: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > 26_214_400) throw new DiscordHttpError(413, 0, 'Request entity too large');
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks);
}

export class DiscordFake {
  readonly world: World;
  readonly gateway: Gateway;
  readonly interactions: Interactions;
  readonly requests: RecordedRequest[] = [];
  readonly botToken: string;
  readonly application: { id: string; name: string; flags: number; interactions_endpoint_url: string | null };
  /** Read it freely; change it with setRateLimits so buckets restart. */
  readonly rate: RateLimitConfig = { enforce: false, webhook: { limit: 5, windowMs: 2000 }, default: { limit: 50, windowMs: 1000 } };
  strictUsernames: boolean;
  private readonly rules: FailureRule[] = [];
  private nextRule = 1;
  private nextRequest = 1;
  private readonly buckets = new Map<string, { count: number; resetAt: number }>();
  private readonly table: CompiledRoute[] = routes().map(compile);
  private readonly clock: () => number;
  private readonly server: Server;
  private origin = '';

  private constructor(options: FakeOptions) {
    this.clock = options.now ?? Date.now;
    this.strictUsernames = options.strictUsernames ?? true;
    const ids = snowflakeGenerator(this.clock);
    const applicationId = options.applicationId ?? ids();
    this.botToken = options.botToken ?? `fake.${randomBytes(24).toString('base64url')}`;
    const flags = options.messageContent === 'off' ? 0 : options.messageContent === 'full' ? AppFlag.messageContentFull : AppFlag.messageContentLimited;
    this.application = { id: applicationId, name: options.botUsername ?? 'Logitland Relay', flags, interactions_endpoint_url: null };
    const botUser: User = {
      id: applicationId,
      username: options.botUsername ?? 'Logitland Relay',
      discriminator: '0',
      global_name: null,
      avatar: null,
      bot: true,
      public_flags: 0,
    };
    // The world emits through the gateway, which is created next and needs the world.
    let gateway: Gateway | undefined;
    this.world = new World({ now: this.clock, ids, emit: (_guild, t, d) => gateway?.dispatch(t, d), botUser });
    this.gateway = gateway = new Gateway(
      {
        world: this.world,
        now: this.clock,
        botToken: () => this.botToken,
        application: () => ({ id: this.application.id, flags: this.application.flags }),
        url: () => this.gatewayUrl,
      },
      options.gateway,
    );
    this.interactions = new Interactions(this, options.interactionKeyPem);
    this.server = createServer((req, res) => void this.handle(req, res));
    this.server.on('upgrade', (req, socket, head) => {
      const path = new URL(req.url ?? '/', 'http://fake').pathname;
      if (path === '/gateway' || path === '/') this.gateway.upgrade(req, socket, head);
      else socket.destroy();
    });
  }

  static async start(options: FakeOptions = {}): Promise<DiscordFake> {
    const fake = new DiscordFake(options);
    const host = options.host ?? '127.0.0.1';
    await new Promise<void>((resolve, reject) => {
      fake.server.once('error', reject);
      fake.server.listen(options.port ?? 0, host, () => resolve());
    });
    fake.origin = `http://${host}:${(fake.server.address() as AddressInfo).port}`;
    return fake;
  }

  async close(): Promise<void> {
    this.gateway.shutdown();
    this.server.closeAllConnections();
    await new Promise<void>((resolve) => this.server.close(() => resolve()));
  }

  /* ---------- Where it is ---------- */

  get url(): string {
    return this.origin;
  }
  get port(): number {
    return Number(new URL(this.origin).port);
  }
  /** The value for the relay's DISCORD_API_BASE. */
  get apiBase(): string {
    return `${this.origin}/api/v10`;
  }
  get controlUrl(): string {
    return `${this.origin}/_fake`;
  }
  get gatewayUrl(): string {
    return `${this.origin.replace(/^http/, 'ws')}/gateway`;
  }
  /** The raw Ed25519 public key (hex) interactions are signed with: the relay's DISCORD_PUBLIC_KEY. */
  get publicKey(): string {
    return this.interactions.publicKeyHex;
  }
  now(): number {
    return this.clock();
  }

  applicationObject(): Record<string, unknown> {
    const { id, name, flags, interactions_endpoint_url } = this.application;
    return {
      id,
      name,
      icon: null,
      description: '',
      bot_public: false,
      bot_require_code_grant: false,
      bot: this.world.botUser,
      verify_key: this.publicKey,
      team: null,
      flags,
      flags_new: String(flags),
      interactions_endpoint_url,
      install_params: { scopes: ['bot', 'applications.commands'], permissions: '0' },
    };
  }

  /** A message as a bot reads it over REST: without the Message Content intent, other people's text is empty. */
  restMessage(m: Message): Message {
    if (this.application.flags & AppFlag.messageContent) return m;
    if (m.author.id === this.world.botUser.id || m.mentions.some((u) => u.id === this.world.botUser.id)) return m;
    const { poll: _poll, ...rest } = m;
    return { ...rest, content: '', embeds: [], attachments: [], components: [] };
  }

  /* ---------- Seeding and acting (the control API in TypeScript) ---------- */

  addGuild(g: { id?: string; name?: string; ownerId?: string; botPermissions?: bigint } = {}): Guild {
    return this.world.addGuild(g);
  }

  addChannel(guildId: string, c: NewChannel): Channel {
    return this.world.addChannel(guildId, c);
  }

  addRole(
    guildId: string,
    r: { id?: string; name: string; permissions?: bigint; position?: number; color?: number; hoist?: boolean; mentionable?: boolean },
  ): Role {
    return this.world.addRole(guildId, r);
  }

  addMember(guildId: string, m: { id?: string; username?: string; global_name?: string | null; roles?: string[]; nick?: string | null }): Member {
    return this.world.addMember(guildId, m);
  }

  /** A webhook on a channel. `url` is the form an admin pastes into the relay; `fakeUrl` is where it really answers. */
  addWebhook(channelId: string, w: { id?: string; token?: string; name?: string } = {}): Webhook & { url: string; fakeUrl: string } {
    const hook = this.world.addWebhook(channelId, w);
    return { ...hook, url: `https://discord.com/api/webhooks/${hook.id}/${hook.token}`, fakeUrl: `${this.apiBase}/webhooks/${hook.id}/${hook.token}` };
  }

  private person(as: string | User): User {
    if (typeof as !== 'string') return as;
    const user = this.world.users.get(as);
    if (!user) throw new Error(`Unknown user ${as}: add the member first`);
    return user;
  }

  /**
   * A person writes in a channel or thread. In a forum or media channel pass `threadName` to start a post.
   * `type` 19 with `replyTo` makes a reply; other types simulate system messages.
   */
  say(
    channelId: string,
    m: {
      as: string | User;
      content: string;
      replyTo?: string;
      type?: number;
      threadName?: string;
      tags?: string[];
      allowedMentions?: { parse?: string[] };
      enforcePermissions?: boolean;
    },
  ): Message {
    const author = this.person(m.as);
    const channel = this.world.channel(channelId);
    // Discord's own apps don't let someone without Send Messages type; by default the fake lets the test decide.
    if (
      m.enforcePermissions &&
      !this.world.canInChannel(channelId, author.id, isThread(channel.type) ? Permission.sendMessagesInThreads : Permission.sendMessages)
    )
      throw new Error(`${author.username} may not send messages in ${channel.name}`);
    const reference = m.replyTo ? { message_id: m.replyTo, channel_id: channelId, guild_id: channel.guild_id } : undefined;
    const input = { author, content: m.content, type: m.type, message_reference: reference, allowed_mentions: m.allowedMentions };
    if (isForum(channel.type)) {
      if (!m.threadName) throw new Error('Posts in a forum or media channel need a threadName');
      return this.world.createForumPost(channelId, { name: m.threadName, ownerId: author.id, appliedTags: m.tags }, input).message;
    }
    return this.world.postMessage(channelId, input);
  }

  edit(channelId: string, messageId: string, content: string): Message {
    return this.world.editMessage(channelId, messageId, { content });
  }

  remove(channelId: string, messageId: string): void {
    this.world.deleteMessage(channelId, messageId);
  }

  removeMany(channelId: string, messageIds: string[]): void {
    this.world.deleteMessages(channelId, messageIds);
  }

  startThread(channelId: string, messageId: string, name: string, as?: string | User): Channel {
    return this.world.createThreadFromMessage(channelId, messageId, { name, ownerId: as ? this.person(as).id : this.world.botUser.id });
  }

  /** Everything in a channel or thread, oldest first, with full text. */
  messages(channelId: string): Message[] {
    this.world.channel(channelId);
    return [...this.world.messagesIn(channelId)];
  }

  /** Messages the relay's webhook for this channel posted, oldest first. */
  webhookMessages(channelId: string): Message[] {
    return this.messages(channelId).filter((m) => m.webhook_id !== undefined);
  }

  /** A slash command or button click, signed and sent to the relay's interactions endpoint. */
  interact(spec: InteractionSpec): Promise<InteractionResult> {
    return this.interactions.send(spec);
  }

  /* ---------- What happened ---------- */

  /** Recorded requests, optionally for one route name (or a 'prefix.*'). */
  requestsTo(route?: string | RegExp): RecordedRequest[] {
    if (route === undefined) return [...this.requests];
    return this.requests.filter((r) => matchName(route, r.route));
  }

  /** Polls until `check` returns something truthy, or throws after `timeoutMs`. */
  async waitFor<T>(check: () => T | Promise<T>, opts: { timeoutMs?: number; intervalMs?: number; message?: string } = {}): Promise<NonNullable<T>> {
    const deadline = Date.now() + (opts.timeoutMs ?? 10_000);
    for (;;) {
      const value = await check();
      if (value) return value as NonNullable<T>;
      if (Date.now() > deadline) throw new Error(opts.message ?? 'Timed out waiting for the fake Discord to reach the expected state');
      await sleep(opts.intervalMs ?? 25);
    }
  }

  /** Clears the request log, the Gateway frame log and failure rules, and optionally the messages too. */
  reset(opts: { messages?: boolean } = {}): void {
    this.requests.length = 0;
    this.gateway.frames.length = 0;
    this.rules.length = 0;
    this.buckets.clear();
    if (opts.messages) this.world.clearMessages();
  }

  /* ---------- Failures ---------- */

  /** Makes matching requests fail. By default the rule fires once; pass `times: Infinity` to keep it. */
  fail(match: FailureMatch, behaviour: Behaviour, opts: { times?: number } = {}): FailureRule {
    const rule: FailureRule = {
      id: this.nextRule++,
      match,
      behaviour,
      times: opts.times ?? 1,
      hits: 0,
      remove: () => {
        const at = this.rules.indexOf(rule);
        if (at >= 0) this.rules.splice(at, 1);
      },
    };
    this.rules.push(rule);
    return rule;
  }

  get failures(): readonly FailureRule[] {
    return this.rules;
  }

  clearFailures(): void {
    this.rules.length = 0;
  }

  private ruleFor(route: string, method: string, path: string, params: Record<string, string>): FailureRule | null {
    const channelId = params.channel ?? (params.id ? this.world.webhooks.get(params.id)?.channel_id : undefined);
    const webhookId = this.world.webhooks.has(params.id ?? '') ? params.id : undefined;
    for (const rule of this.rules) {
      if (rule.hits >= rule.times) continue;
      const m = rule.match;
      if (m.route !== undefined && !matchName(m.route, route)) continue;
      if (m.method !== undefined && m.method.toUpperCase() !== method) continue;
      if (m.path !== undefined && !(typeof m.path === 'string' ? path === m.path : m.path.test(path))) continue;
      if (m.channelId !== undefined && m.channelId !== channelId) continue;
      if (m.webhookId !== undefined && m.webhookId !== webhookId) continue;
      return rule;
    }
    return null;
  }

  /* ---------- Rate limits ---------- */

  /** Changes the limits and starts every bucket afresh, so the new numbers apply to the very next request. */
  setRateLimits(patch: { enforce?: boolean; webhook?: Partial<BucketSpec>; default?: Partial<BucketSpec> }): RateLimitConfig {
    if (patch.enforce !== undefined) this.rate.enforce = patch.enforce;
    Object.assign(this.rate.webhook, patch.webhook);
    Object.assign(this.rate.default, patch.default);
    this.buckets.clear();
    return this.rate;
  }

  private bucketFor(route: Route, params: Record<string, string>): { key: string; spec: BucketSpec; bucket: string } {
    const major = params[route.bucket] ?? params.id ?? route.bucket;
    const webhook = route.name.startsWith('webhook.');
    const key = webhook ? `webhook:${params.id}` : `${route.bucket}:${major}`;
    return { key, spec: webhook ? this.rate.webhook : this.rate.default, bucket: Buffer.from(key).toString('hex').slice(0, 32) };
  }

  /** Counts this request against its bucket, per webhook for webhook routes. */
  private touch(route: Route, params: Record<string, string>): { headers: Record<string, string>; exhausted: boolean; retryAfter: number } {
    const { key, spec, bucket } = this.bucketFor(route, params);
    const now = this.now();
    let b = this.buckets.get(key);
    if (!b || now >= b.resetAt) this.buckets.set(key, (b = { count: 0, resetAt: now + spec.windowMs }));
    b.count++;
    const remaining = Math.max(spec.limit - b.count, 0);
    const resetAfter = Math.max(b.resetAt - now, 0) / 1000;
    return {
      headers: {
        'x-ratelimit-limit': String(spec.limit),
        'x-ratelimit-remaining': String(remaining),
        'x-ratelimit-reset': (b.resetAt / 1000).toFixed(3),
        'x-ratelimit-reset-after': resetAfter.toFixed(3),
        'x-ratelimit-bucket': bucket,
      },
      exhausted: b.count > spec.limit,
      retryAfter: resetAfter,
    };
  }

  /* ---------- The HTTP server ---------- */

  private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    try {
      const url = new URL(req.url ?? '/', 'http://fake');
      if (url.pathname === '/_fake' || url.pathname.startsWith('/_fake/')) return await handleControl(this, req, res, url);
      await this.rest(req, res, url);
    } catch (err) {
      if (!res.headersSent) {
        const e =
          err instanceof DiscordHttpError
            ? err
            : new DiscordHttpError(500, 0, `The fake failed: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}`);
        res.writeHead(e.status, { 'content-type': 'application/json' }).end(JSON.stringify(e.body()));
      }
    }
  }

  private apiPath(pathname: string): string | null {
    const m = /^\/api(?:\/v(?:9|10))?(\/.*)$/.exec(pathname);
    return m ? m[1]! : null;
  }

  private async rest(req: IncomingMessage, res: ServerResponse, url: URL): Promise<void> {
    const method = (req.method ?? 'GET').toUpperCase();
    const path = this.apiPath(url.pathname);
    const headers: Record<string, string> = {};
    for (const [k, v] of Object.entries(req.headers)) if (v !== undefined) headers[k] = Array.isArray(v) ? v.join(', ') : v;
    const query = Object.fromEntries(url.searchParams);
    const record: RecordedRequest = {
      n: this.nextRequest++,
      at: new Date(this.now()).toISOString(),
      route: 'unknown',
      method,
      path: path ?? url.pathname,
      query,
      headers,
      body: undefined,
      status: 0,
      reply: undefined,
      injected: null,
      params: {},
    };
    const raw = await readBody(req);
    const contentType = String(req.headers['content-type'] ?? '');
    let parsed: unknown;
    let bodyError: DiscordHttpError | null = null;
    if (raw.length) {
      if (/^application\/json/i.test(contentType)) {
        try {
          parsed = JSON.parse(raw.toString('utf8'));
        } catch {
          record.body = raw.toString('utf8');
          bodyError = errors.invalidJson();
        }
        if (!bodyError) record.body = parsed;
      } else {
        record.body = raw.toString('utf8');
        bodyError = formBody([], 'INVALID_CONTENT_TYPE', 'Expected "Content-Type" header to be one of {\'application/json\'}.');
      }
    }

    const respond = (status: number, json: unknown, extra: Record<string, string> = {}) => {
      record.status = status;
      record.reply = json;
      this.requests.push(record);
      if (status === 204 || json === undefined) res.writeHead(status, extra).end();
      else res.writeHead(status, { 'content-type': 'application/json', ...extra }).end(JSON.stringify(json));
    };
    const drop = () => {
      record.status = 0;
      this.requests.push(record);
      req.socket.destroy();
    };
    const fail = (e: DiscordHttpError, extra: Record<string, string> = {}) => respond(e.status, e.body(), extra);

    if (path === null) return fail(errors.notFound());
    let hit: { route: Route; params: Record<string, string> } | null = null;
    let wrongMethod = false;
    for (const c of this.table) {
      const m = c.regex.exec(path);
      if (!m) continue;
      if (c.route.method !== method) {
        wrongMethod = true;
        continue;
      }
      hit = { route: c.route, params: Object.fromEntries(c.keys.map((k, i) => [k, decodeURIComponent(m[i + 1]!)])) };
      break;
    }
    if (!hit) return fail(wrongMethod ? errors.methodNotAllowed() : errors.notFound());
    const { route, params } = hit;
    record.route = route.name;
    record.params = params;

    const bucket = this.touch(route, params);
    const rule = this.ruleFor(route.name, method, path, params);
    if (rule) {
      rule.hits++;
      record.injected = rule.behaviour.type;
      const b = rule.behaviour;
      if (b.type === 'rate_limit') {
        const retryAfter = b.retryAfter ?? 1;
        const scope = b.scope ?? (b.global ? 'global' : 'user');
        return respond(
          429,
          { message: 'You are being rate limited.', retry_after: retryAfter, global: b.global ?? false },
          {
            ...bucket.headers,
            'x-ratelimit-remaining': '0',
            'x-ratelimit-reset-after': retryAfter.toFixed(3),
            'retry-after': String(Math.max(1, Math.ceil(retryAfter))),
            'x-ratelimit-scope': scope,
            ...(b.global ? { 'x-ratelimit-global': 'true' } : {}),
          },
        );
      }
      if (b.type === 'status') {
        const status = b.status ?? 500;
        return respond(status, b.body ?? { message: status >= 500 ? 'Internal Server Error' : `Injected ${status}`, code: 0 }, bucket.headers);
      }
      if (b.type === 'drop' && (b.phase ?? 'before') === 'before') return drop();
      if (b.type === 'slow' && (b.phase ?? 'before') === 'before') await sleep(b.ms);
    }

    if (this.rate.enforce && bucket.exhausted) {
      const retryAfter = bucket.retryAfter;
      return respond(
        429,
        { message: 'You are being rate limited.', retry_after: retryAfter, global: false },
        { ...bucket.headers, 'retry-after': String(Math.max(1, Math.ceil(retryAfter))), 'x-ratelimit-scope': 'user' },
      );
    }

    let status: number;
    let json: unknown;
    try {
      if (route.auth === 'bot') {
        if (headers.authorization !== `Bot ${this.botToken}`) throw errors.unauthorized();
      }
      if (bodyError && method !== 'GET' && method !== 'DELETE') throw bodyError;
      const reply = await route.handler({ fake: this, params, query: url.searchParams, body: parsed, headers: req.headers });
      status = reply.status;
      json = reply.json;
    } catch (err) {
      if (!(err instanceof DiscordHttpError)) throw err;
      status = err.status;
      json = err.body();
    }

    if (rule?.behaviour.type === 'drop') return drop();
    if (rule?.behaviour.type === 'slow' && rule.behaviour.phase === 'after') await sleep(rule.behaviour.ms);
    respond(status, json, bucket.headers);
  }
}

function matchName(pattern: string | RegExp, name: string): boolean {
  if (pattern instanceof RegExp) return pattern.test(name);
  return pattern.endsWith('*') ? name.startsWith(pattern.slice(0, -1)) : pattern === name;
}

export type { ChannelKind };
