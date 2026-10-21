// The control API: small JSON endpoints under /_fake so a test or script in another process can seed the fake,
// post as people, read what was posted, inject failures and steer the Gateway. Each one is the HTTP face of a
// method on DiscordFake. No authentication: the fake only listens on loopback.

import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Channel } from './model.ts';
import type { Behaviour, DiscordFake, FailureMatch } from './fake.ts';

const FLAGS = { limited: 1 << 19, full: 1 << 18, off: 0 } as const;

class ControlError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

type Json = Record<string, unknown>;

function field<T>(body: Json, key: string, type: 'string' | 'number' | 'boolean' | 'object' | 'array', required = true): T | undefined {
  const v = body[key];
  if (v === undefined || v === null) {
    if (required) throw new ControlError(400, `${key} is required`);
    return undefined;
  }
  const ok = type === 'array' ? Array.isArray(v) : type === 'object' ? typeof v === 'object' && !Array.isArray(v) : typeof v === type;
  if (!ok) throw new ControlError(400, `${key} must be ${type === 'array' ? 'an array' : `a ${type}`}`);
  return v as T;
}

const str = (b: Json, k: string) => field<string>(b, k, 'string')!;
const optStr = (b: Json, k: string) => field<string>(b, k, 'string', false);

/** What the control API shows of a channel: enough to find IDs and the webhook that posts into it. */
function describeChannel(fake: DiscordFake, c: Channel) {
  return {
    id: c.id,
    name: c.name,
    type: c.type,
    parent_id: c.parent_id,
    ...(c.available_tags ? { available_tags: c.available_tags } : {}),
    ...(c.thread_metadata ? { archived: c.thread_metadata.archived, locked: c.thread_metadata.locked } : {}),
    webhooks: [...fake.world.webhooks.values()]
      .filter((w) => w.channel_id === c.id)
      .map((w) => ({
        id: w.id,
        token: w.token,
        name: w.name,
        url: `https://discord.com/api/webhooks/${w.id}/${w.token}`,
        fake_url: `${fake.apiBase}/webhooks/${w.id}/${w.token}`,
      })),
    messages: fake.world.messagesIn(c.id).length,
  };
}

export function snapshot(fake: DiscordFake): Json {
  const w = fake.world;
  return {
    url: fake.url,
    api_base: fake.apiBase,
    gateway_url: fake.gatewayUrl,
    bot_token: fake.botToken,
    public_key: fake.publicKey,
    application: fake.application,
    guilds: [...w.guilds.values()].map((g) => ({
      id: g.id,
      name: g.name,
      owner_id: g.owner_id,
      roles: [...g.roles.values()],
      members: [...g.members.values()].map((m) => ({
        id: m.user.id,
        username: m.user.username,
        global_name: m.user.global_name,
        bot: m.user.bot ?? false,
        roles: m.roles,
      })),
      channels: [...g.channelIds].map((id) => describeChannel(fake, w.channels.get(id)!)),
    })),
    gateway: {
      connected: fake.gateway.connected,
      sessions: fake.gateway.info(),
      ack_heartbeats: fake.gateway.ackHeartbeats,
      options: fake.gateway.options,
      session_start_limit: fake.gateway.sessionStartLimit,
    },
    rate_limits: fake.rate,
    failures: fake.failures.map((f) => ({ id: f.id, match: f.match, behaviour: f.behaviour, times: f.times === Infinity ? 'forever' : f.times, hits: f.hits })),
    requests: fake.requests.length,
    interactions: fake.interactions.all().length,
  };
}

function failureMatch(m: unknown): FailureMatch {
  const o = (m ?? {}) as Json;
  const out: FailureMatch = {};
  if (typeof o.route === 'string') out.route = o.route;
  if (typeof o.method === 'string') out.method = o.method;
  if (typeof o.path === 'string') out.path = o.path;
  if (typeof o.channelId === 'string') out.channelId = o.channelId;
  if (typeof o.webhookId === 'string') out.webhookId = o.webhookId;
  return out;
}

type Handler = (fake: DiscordFake, body: Json, params: string[], query: URLSearchParams) => unknown | Promise<unknown>;

const table: [string, RegExp, Handler][] = [
  ['GET', /^\/state$/, (fake) => snapshot(fake)],

  [
    'POST',
    /^\/clear$/,
    (fake, b) => {
      fake.reset({ messages: b.messages === true });
      return { ok: true };
    },
  ],

  /* ----- Seeding ----- */

  [
    'POST',
    /^\/guilds$/,
    (fake, b) => {
      const g = fake.addGuild({ id: optStr(b, 'id'), name: optStr(b, 'name'), ownerId: optStr(b, 'owner_id') });
      return { id: g.id, name: g.name, everyone_role_id: g.everyoneRoleId, bot_role_id: g.botRoleId, owner_id: g.owner_id };
    },
  ],

  [
    'POST',
    /^\/channels$/,
    (fake, b) => {
      const c = fake.addChannel(str(b, 'guild'), {
        id: optStr(b, 'id'),
        name: str(b, 'name'),
        kind: (b.type as number | undefined) ?? ((optStr(b, 'kind') ?? 'text') as 'text'),
        parentId: optStr(b, 'parent'),
        topic: optStr(b, 'topic'),
        tags: field<{ id?: string; name: string; moderated?: boolean }[]>(b, 'tags', 'array', false),
        // Permissions as decimal strings, as Discord sends them: [{ id, type: 'role' | 'member', allow, deny }].
        overwrites: field<{ id: string; type?: 'role' | 'member'; allow?: string; deny?: string }[]>(b, 'overwrites', 'array', false)?.map((o) => ({
          id: o.id,
          type: o.type,
          allow: o.allow === undefined ? undefined : BigInt(o.allow),
          deny: o.deny === undefined ? undefined : BigInt(o.deny),
        })),
      });
      return describeChannel(fake, c);
    },
  ],

  [
    'POST',
    /^\/roles$/,
    (fake, b) => {
      const permissions = b.permissions === undefined ? undefined : BigInt(b.permissions as string);
      return fake.addRole(str(b, 'guild'), { id: optStr(b, 'id'), name: str(b, 'name'), permissions, position: field<number>(b, 'position', 'number', false) });
    },
  ],

  [
    'POST',
    /^\/members$/,
    (fake, b) => {
      const m = fake.addMember(str(b, 'guild'), {
        id: optStr(b, 'id'),
        username: optStr(b, 'username'),
        global_name: optStr(b, 'global_name'),
        roles: field<string[]>(b, 'roles', 'array', false),
      });
      return { id: m.user.id, username: m.user.username, roles: m.roles };
    },
  ],

  ['POST', /^\/webhooks$/, (fake, b) => fake.addWebhook(str(b, 'channel'), { id: optStr(b, 'id'), token: optStr(b, 'token'), name: optStr(b, 'name') })],

  /* ----- People ----- */

  [
    'POST',
    /^\/messages$/,
    (fake, b) =>
      fake.say(str(b, 'channel'), {
        as: str(b, 'as'),
        content: str(b, 'content'),
        replyTo: optStr(b, 'reply_to'),
        type: field<number>(b, 'type', 'number', false),
        threadName: optStr(b, 'thread_name'),
        tags: field<string[]>(b, 'tags', 'array', false),
      }),
  ],

  [
    'POST',
    /^\/messages\/bulk-delete$/,
    (fake, b) => {
      fake.removeMany(str(b, 'channel'), field<string[]>(b, 'ids', 'array')!);
      return { ok: true };
    },
  ],

  ['PATCH', /^\/messages\/(\d+)\/(\d+)$/, (fake, b, [channel, id]) => fake.edit(channel!, id!, str(b, 'content'))],

  [
    'DELETE',
    /^\/messages\/(\d+)\/(\d+)$/,
    (fake, _b, [channel, id]) => {
      fake.remove(channel!, id!);
      return { ok: true };
    },
  ],

  [
    'GET',
    /^\/messages$/,
    (fake, _b, _p, q) => {
      const channel = q.get('channel');
      if (!channel) throw new ControlError(400, 'channel is required');
      const list = q.get('webhook') === '1' ? fake.webhookMessages(channel) : fake.messages(channel);
      return { messages: list };
    },
  ],

  ['POST', /^\/threads$/, (fake, b) => fake.startThread(str(b, 'channel'), str(b, 'message'), str(b, 'name'), optStr(b, 'as'))],

  [
    'PATCH',
    /^\/threads\/(\d+)$/,
    (fake, b, [id]) =>
      fake.world.updateThread(id!, {
        name: optStr(b, 'name'),
        archived: field<boolean>(b, 'archived', 'boolean', false),
        locked: field<boolean>(b, 'locked', 'boolean', false),
        appliedTags: field<string[]>(b, 'tags', 'array', false),
      }),
  ],

  [
    'DELETE',
    /^\/threads\/(\d+)$/,
    (fake, _b, [id]) => {
      fake.world.deleteThread(id!);
      return { ok: true };
    },
  ],

  [
    'POST',
    /^\/members\/(\d+)\/(\d+)\/roles\/(\d+)$/,
    (fake, b, [guild, user, role]) => {
      fake.world.setMemberRole(guild!, user!, role!, b.remove !== true);
      return { ok: true };
    },
  ],

  [
    'POST',
    /^\/interactions$/,
    (fake, b) =>
      fake.interact({
        user: str(b, 'user'),
        guildId: optStr(b, 'guild'),
        channelId: optStr(b, 'channel'),
        command: field<{ name: string; subcommand?: string }>(b, 'command', 'object', false),
        button: field<{ customId: string; messageId?: string }>(b, 'button', 'object', false),
        ping: b.ping === true,
        endpoint: optStr(b, 'endpoint'),
        signature: optStr(b, 'signature') as 'valid' | 'invalid' | 'missing' | undefined,
        timestamp: field<number>(b, 'timestamp', 'number', false),
      }),
  ],

  ['GET', /^\/interactions$/, (fake) => ({ interactions: fake.interactions.all() })],

  /* ----- What happened ----- */

  [
    'GET',
    /^\/requests$/,
    (fake, _b, _p, q) => {
      const route = q.get('route') ?? undefined;
      const since = Number(q.get('since') ?? 0);
      const list = fake.requestsTo(route).filter((r) => r.n > since);
      return { requests: list.slice(-Number(q.get('limit') ?? 500)) };
    },
  ],

  [
    'DELETE',
    /^\/requests$/,
    (fake) => {
      fake.requests.length = 0;
      return { ok: true };
    },
  ],

  /* ----- Failures ----- */

  ['GET', /^\/failures$/, (fake) => ({ failures: snapshot(fake).failures })],

  [
    'POST',
    /^\/failures$/,
    (fake, b) => {
      const behaviour = field<Behaviour>(b, 'behaviour', 'object')!;
      if (!['rate_limit', 'status', 'slow', 'drop'].includes(behaviour.type))
        throw new ControlError(400, 'behaviour.type must be rate_limit, status, slow or drop');
      const times = b.times === 'forever' ? Infinity : (field<number>(b, 'times', 'number', false) ?? 1);
      const rule = fake.fail(failureMatch(b.match), behaviour, { times });
      return { id: rule.id };
    },
  ],

  [
    'DELETE',
    /^\/failures(?:\/(\d+))?$/,
    (fake, _b, [id]) => {
      if (id) fake.failures.find((f) => f.id === Number(id))?.remove();
      else fake.clearFailures();
      return { ok: true };
    },
  ],

  /* ----- Gateway ----- */

  [
    'GET',
    /^\/gateway$/,
    (fake, _b, _p, q) => ({
      sessions: fake.gateway.info(),
      frames: fake.gateway.frames.slice(-Number(q.get('limit') ?? 200)),
    }),
  ],
  [
    'POST',
    /^\/gateway\/reconnect$/,
    (fake) => {
      fake.gateway.reconnect();
      return { ok: true };
    },
  ],
  [
    'POST',
    /^\/gateway\/close$/,
    (fake, b) => {
      fake.gateway.close(field<number>(b, 'code', 'number', false) ?? 4000, optStr(b, 'reason') ?? '', { forget: b.forget === true });
      return { ok: true };
    },
  ],
  [
    'POST',
    /^\/gateway\/drop$/,
    (fake) => {
      fake.gateway.drop();
      return { ok: true };
    },
  ],
  [
    'POST',
    /^\/gateway\/invalidate$/,
    (fake, b) => {
      fake.gateway.invalidate(b.resumable === true);
      return { ok: true };
    },
  ],
  [
    'POST',
    /^\/gateway\/heartbeats$/,
    (fake, b) => {
      fake.gateway.ackHeartbeats = b.ack !== false;
      return { ack: fake.gateway.ackHeartbeats };
    },
  ],
  [
    'POST',
    /^\/gateway\/next-resume$/,
    (fake, b) => {
      const mode = str(b, 'mode');
      if (mode !== 'ok' && mode !== 'invalid' && mode !== 'invalid-resumable') throw new ControlError(400, 'mode must be ok, invalid or invalid-resumable');
      fake.gateway.nextResume = mode;
      return { mode };
    },
  ],
  [
    'POST',
    /^\/gateway\/forget$/,
    (fake) => {
      fake.gateway.forgetSessions();
      return { ok: true };
    },
  ],
  [
    'POST',
    /^\/gateway\/raw$/,
    (fake, b) => {
      fake.gateway.sendRaw(str(b, 'text'));
      return { ok: true };
    },
  ],
  [
    'POST',
    /^\/gateway\/options$/,
    (fake, b) => {
      for (const k of ['heartbeatIntervalMs', 'resumeWindowMs', 'eventLagMs', 'bufferLimit'] as const) {
        const v = field<number>(b, k, 'number', false);
        if (v !== undefined) fake.gateway.options[k] = v;
      }
      return fake.gateway.options;
    },
  ],
  [
    'POST',
    /^\/gateway\/session-limit$/,
    (fake, b) => {
      const limit = fake.gateway.sessionStartLimit;
      limit.remaining = field<number>(b, 'remaining', 'number', false) ?? limit.remaining;
      const reset = field<number>(b, 'reset_after_ms', 'number', false);
      if (reset !== undefined) limit.resetAt = fake.now() + reset;
      return limit;
    },
  ],

  /* ----- Application and limits ----- */

  [
    'PATCH',
    /^\/application$/,
    (fake, b) => {
      if (b.interactions_endpoint_url !== undefined) fake.application.interactions_endpoint_url = (b.interactions_endpoint_url as string | null) || null;
      const mc = optStr(b, 'messageContent');
      if (mc !== undefined) {
        if (!(mc in FLAGS)) throw new ControlError(400, 'messageContent must be limited, full or off');
        fake.application.flags = FLAGS[mc as keyof typeof FLAGS];
      }
      return fake.application;
    },
  ],

  [
    'POST',
    /^\/rate-limits$/,
    (fake, b) =>
      fake.setRateLimits({
        enforce: typeof b.enforce === 'boolean' ? b.enforce : undefined,
        webhook: b.webhook as { limit?: number; windowMs?: number } | undefined,
        default: b.default as { limit?: number; windowMs?: number } | undefined,
      }),
  ],
];

export async function handleControl(fake: DiscordFake, req: IncomingMessage, res: ServerResponse, url: URL): Promise<void> {
  const path = url.pathname.replace(/^\/_fake/, '') || '/';
  const method = (req.method ?? 'GET').toUpperCase();
  const send = (status: number, json: unknown): void => {
    res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(json));
  };
  try {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk as Buffer);
    const raw = Buffer.concat(chunks).toString('utf8');
    let body: Json = {};
    if (raw.trim()) {
      try {
        body = JSON.parse(raw) as Json;
      } catch {
        throw new ControlError(400, 'The body is not JSON');
      }
    }
    for (const [m, re, handler] of table) {
      const match = re.exec(path);
      if (!match) continue;
      if (m !== method) continue;
      return send(200, await handler(fake, body, match.slice(1), url.searchParams));
    }
    throw new ControlError(404, `No control route for ${method} ${path}`);
  } catch (err) {
    if (err instanceof ControlError) return send(err.status, { error: err.message });
    const message = err instanceof Error ? err.message : String(err);
    // The world refuses with Discord-shaped errors (unknown channel and so on); show them plainly.
    send(400, { error: message });
  }
}
