// Shared by the posting tests: a fake Discord that behaves like the real one for the calls posting makes
// (webhook posts, thread creation, edits, deletes), channels of every type, and small request helpers.

import type { ChannelType } from '@logitland/contracts';
import { GUILD, LOUNGE, harness, seedAgent, seedChannel, type Harness, type HarnessOptions, type SeedAccess } from './testing';
import type { ModerationRequest, ModerationResult, Moderator } from './services/moderation/classifier';

export const ANNOUNCE = '110000000000000010';
export const MEDIA = '110000000000000011';
export const FORUM_ID = '110000000000000003';
/** The thread Discord makes for a new forum or media post. */
export const NEW_THREAD = '120000000000000009';

export const pass: ModerationResult = { verdict: 'pass' };
export const down: ModerationResult = { verdict: null, unavailable: true, reason: 'it is down' };

/** A classifier that records what it was asked and answers with `answer`. */
export function mod(answer: ModerationResult | ((req: ModerationRequest) => ModerationResult) = pass) {
  const calls: ModerationRequest[] = [];
  const moderator: Moderator & { calls: ModerationRequest[] } = {
    calls,
    review: async (req) => {
      calls.push(req);
      return typeof answer === 'function' ? answer(req) : answer;
    },
  };
  return moderator;
}

const FORUMS = new Set([FORUM_ID, MEDIA]);

export interface FakeDiscordOptions {
  /** Answer thread creation (POST /channels/:id/messages/:id/threads). Default: a thread whose ID is the message ID. */
  thread?: (req: Request, messageId: string) => Response | Promise<Response>;
  /** Answer edits and deletes. Default: success. */
  change?: (req: Request) => Response | Promise<Response>;
  /** Extra headers on webhook post answers, e.g. rate-limit headers. */
  headers?: Record<string, string>;
}

/** Installs a fake Discord on the harness. Webhook tokens are `token-<channel id>`, which is how it knows the parent channel. */
export function fakeDiscord(h: Harness, opts: FakeDiscordOptions = {}) {
  let next = 300000000000009000n;
  h.setDiscord(async (req) => {
    const url = new URL(req.url);
    const thread = /\/channels\/(\d+)\/messages\/(\d+)\/threads$/.exec(url.pathname);
    if (thread) {
      if (opts.thread) return opts.thread(req, thread[2]!);
      const body = (await req.clone().json()) as { name: string };
      return Response.json({ id: thread[2], guild_id: GUILD, parent_id: thread[1], name: body.name, type: 11 });
    }
    if (req.method === 'PATCH' || req.method === 'DELETE')
      return opts.change ? opts.change(req) : req.method === 'DELETE' ? new Response(null, { status: 204 }) : Response.json({ ok: true });
    const webhookFor = /\/channels\/(\d+)\/webhooks$/.exec(url.pathname)?.[1];
    if (webhookFor) {
      next += 1n;
      return Response.json({ id: String(next), token: `token-${webhookFor}`, channel_id: webhookFor, name: 'Logitland agents' });
    }
    const parent = /token-(\d+)/.exec(url.pathname)?.[1] ?? LOUNGE;
    const body = (await req
      .clone()
      .json()
      .catch(() => ({}))) as { content?: string; thread_name?: string };
    next += 1n;
    const channel_id = body.thread_name && FORUMS.has(parent) ? NEW_THREAD : (url.searchParams.get('thread_id') ?? parent);
    return Response.json(
      { id: String(next), channel_id, content: body.content ?? '', timestamp: h.now().toISOString(), edited_timestamp: null },
      { headers: opts.headers },
    );
  });
}

export interface World {
  h: Harness;
  /** A level 1 agent, so no probation. */
  a: Awaited<ReturnType<typeof seedAgent>>;
}

/** One channel of each type, all open for posting, a level 1 agent, and the fake Discord. */
export async function world(opts: HarnessOptions & { access?: SeedAccess; discord?: FakeDiscordOptions } = {}): Promise<World> {
  const { access = 'post', discord, ...harnessOptions } = opts;
  const h = harness({ moderator: mod(), ...harnessOptions });
  const types: [string, string, ChannelType][] = [
    [LOUNGE, 'lounge', 'text'],
    [ANNOUNCE, 'news', 'announcement'],
    [FORUM_ID, 'forum', 'forum'],
    [MEDIA, 'media', 'media'],
  ];
  for (const [id, name, type] of types) await seedChannel(h.relay, { id, name, type, access });
  fakeDiscord(h, discord);
  return { h, a: await seedAgent(h.relay) };
}

/** Text of exactly `n` characters that no spam rule objects to. */
export const filler = (n: number) => `${Array.from({ length: Math.ceil(n / 3) + 1 }, (_, i) => `w${i}`).join(' ')}`.slice(0, n).replace(/ $/, 'z');

let counter = 0;
export const key = () => `fixture-key-${++counter}-padding`;

export const post = (h: Harness, a: { token: string }, body: Record<string, unknown>, idem: string | null = key()) =>
  h.call('POST', '/v1/messages', body, { ...h.as(a.token), ...(idem ? { 'idempotency-key': idem } : {}) });
export const patch = (h: Harness, a: { token: string }, id: string, body: Record<string, unknown>) =>
  h.call('PATCH', `/v1/messages/${id}`, body, h.as(a.token));
export const remove = (h: Harness, a: { token: string }, id: string) => h.call('DELETE', `/v1/messages/${id}`, undefined, h.as(a.token));
export const say = (content: string, extra: Record<string, unknown> = {}, channel_id = LOUNGE) => ({ channel_id, content, ...extra });
export const json = async (res: Response) => (await res.json()) as Record<string, any>;
export const row = (h: Harness, id: string) => h.db.prepare('SELECT * FROM relay_messages WHERE id = ?').bind(id).first<Record<string, any>>();

/** What the fake Discord was sent, for one kind of call. */
export async function calls(h: Harness, method: string, match: RegExp = /./) {
  const out: { url: URL; body: any; headers: Headers }[] = [];
  for (const c of h.discordCalls) {
    const url = new URL(c.url);
    if (c.method === method && match.test(url.pathname))
      out.push({
        url,
        body:
          method === 'DELETE'
            ? null
            : await c
                .clone()
                .json()
                .catch(() => null),
        headers: c.headers,
      });
  }
  return out;
}

export const WEBHOOK_POST = /\/webhooks\/\d+\/token-\d+$/;
export const WEBHOOK_MESSAGE = /\/webhooks\/\d+\/token-\d+\/messages\/\d+$/;
export const THREAD_START = /\/channels\/\d+\/messages\/\d+\/threads$/;

/** Sets a forum channel's tags the way the admin console saves them. */
export const setTags = (h: Harness, channelId: string, tags: { id: string; name: string; moderated?: boolean }[]) =>
  h.db.prepare('UPDATE channels SET tags = ? WHERE id = ?').bind(JSON.stringify(tags), channelId).run();

export const seedThread = (h: Harness, id: string, parent: string, extra: { locked?: boolean; deleted?: boolean } = {}) =>
  h.db
    .prepare('INSERT INTO threads (id, parent_id, name, created_at, locked, deleted_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .bind(id, parent, 'a thread', h.now().toISOString(), extra.locked ? 1 : 0, extra.deleted ? h.now().toISOString() : null, h.now().toISOString())
    .run();

let snowflake = 800000000000000000n;
/** A message in the conversation, as intake would have stored it. */
export async function converse(
  h: Harness,
  m: {
    author?: 'agent' | 'human' | 'bot' | 'webhook';
    name?: string;
    thread?: string | null;
    channel?: string;
    deleted?: boolean;
    userId?: string | null;
    content?: string;
  },
) {
  snowflake += 1n;
  await h.db
    .prepare(
      "INSERT INTO conversation (message_id, channel_id, thread_id, author_kind, agent_id, author_ref, discord_user_id, display_name, content, created_at, deleted_at) VALUES (?, ?, ?, ?, NULL, 'p_x', ?, ?, ?, ?, ?)",
    )
    .bind(
      String(snowflake),
      m.channel ?? LOUNGE,
      m.thread ?? null,
      m.author ?? 'human',
      m.userId ?? null,
      m.name ?? 'Ann',
      m.content ?? 'hello everyone',
      h.now().toISOString(),
      m.deleted ? h.now().toISOString() : null,
    )
    .run();
  return String(snowflake);
}
