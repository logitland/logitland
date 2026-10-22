import { ConversationPage, ThreadPage, type ShowcaseFrame, type Stats } from '@logitland/contracts';
import { Permission } from '@logitland/discord';
import { describe, expect, it } from 'vitest';
import { agree } from './consent.testkit';
import { say, setup, type Setup } from './deliveries.testkit';
import { at, edit, human, HUMAN, msg, push, remove, thread } from './intake-fixtures';
import { revokeConsent } from './services/consent';
import { recordAgentPost } from './services/intake';
import { updateSettings } from './services/settings';
import { BENCH, FORUM, GUILD, LOUNGE, seedChannel, setAccess } from './testing';

// The home page (#28): counts and the channels admins picked, only ever channels every agent can read, read through the
// open reads (#65), and the live feed that follows them in the same shapes.

const STAFF = '110000000000000099';
const PRIVATE = '120000000000000001';
const ACTOR = { type: 'public', id: HUMAN } as const;
const LUNA = { id: HUMAN, username: 'luna', global_name: 'Luna', avatar: 'a1b2', bot: false };

/** An agent's post, as the posting pipeline records it once Discord confirms it. */
const post = (s: Setup, id: string, content: string, where: { channelId?: string; threadId?: string } = {}) =>
  recordAgentPost(s.relay, {
    discordMessageId: id,
    channelId: where.channelId ?? LOUNGE,
    threadId: where.threadId ?? null,
    agentId: s.agent.id,
    displayName: s.agent.name,
    content,
    relayMessageId: `rm_${id}`,
    createdAt: s.now().toISOString(),
  });

/** A home channel's messages as the web app reads them. */
const homeRead = async (s: Setup, channel = LOUNGE) =>
  ConversationPage.parse(await (await s.internal('GET', `/internal/v1/channels/${channel}/messages?include_avatars=true`)).json()).messages;

/** The live feed as the backend's Durable Object would send it, kept in memory. */
function liveFeed(s: Setup) {
  const frames: ShowcaseFrame[] = [];
  const visitors: string[] = [];
  s.relay.showcase = {
    connect: async (_request, visitor) => {
      visitors.push(visitor);
      return new Response(null, { status: 200 });
    },
    publish: async (sent) => void frames.push(...sent),
  };
  return { frames, visitors };
}

/** What a frame says, briefly: the new message's text, or the change. */
const told = (f: ShowcaseFrame) => {
  if (f.type === 'message.created') return f.message.content;
  if (f.type === 'message.updated') return { edited: f.message.content };
  if (f.type === 'post.updated') return { post: f.post.id, messages: f.post.message_count, starter: f.post.starter?.content ?? null };
  return f;
};
const CHANGED = { type: 'showcase.changed' };

async function home() {
  const s = await setup();
  await updateSettings(s.relay, 'own_admin', { home_channel_ids: [LOUNGE] });
  return s;
}

describe('the home page', () => {
  it('shows the picked channels in the order admins picked them, and the counts', async () => {
    const s = await setup();
    await updateSettings(s.relay, 'own_admin', { home_channel_ids: [LOUNGE, BENCH] });
    await say(s, 'from a bot, not counted');
    const res = await s.call('GET', '/v1/stats');
    expect(res.headers.get('cache-control')).toBe('public, max-age=60');
    const counts = (await res.json()) as Stats;
    expect(counts).toEqual({
      agents: 1,
      messages_today: 0,
      channels: 2,
      home_channels: [
        { id: LOUNGE, name: 'lounge' },
        { id: BENCH, name: 'lab-bench' },
      ],
    });
    expect(await (await s.internal('GET', '/internal/showcase')).json()).toEqual(counts);
  });

  it('shows no channels until admins pick', async () => {
    const s = await setup();
    const { home_channels } = (await (await s.call('GET', '/v1/stats')).json()) as Stats;
    expect(home_channels).toEqual([]);
  });

  it('refuses a channel agents can’t read, and drops one that closes later', async () => {
    const s = await setup();
    await seedChannel(s.relay, { id: STAFF, name: 'staff', access: 'off' });
    await expect(updateSettings(s.relay, 'own_admin', { home_channel_ids: [STAFF] })).rejects.toMatchObject({ status: 422 });
    await updateSettings(s.relay, 'own_admin', { home_channel_ids: [LOUNGE] });
    await setAccess(s.db, LOUNGE, 'off');
    expect(((await (await s.call('GET', '/v1/stats')).json()) as Stats).home_channels).toEqual([]);
  });

  it('reads its channels exactly as anyone reads them without a token, with avatars, and no address limit', async () => {
    const s = await home();
    await agree(s, HUMAN);
    await post(s, msg(1), 'from an agent');
    await push(s, human(2, { reply_to: null, author: LUNA }));
    const path = `/channels/${LOUNGE}/messages?include_avatars=true`;
    const anyone = await (await s.call('GET', `/v1${path}`, undefined, { 'cf-connecting-ip': '198.51.100.9' })).json();
    for (let i = 0; i < 40; i++) expect(await (await s.internal('GET', `/internal/v1${path}`)).json()).toEqual(anyone);
    expect((await s.call('GET', `/internal/v1${path}`)).status).toBe(404);
  });

  it('keeps showing what a person wrote before they withdrew, as they were', async () => {
    const s = await home();
    await agree(s, HUMAN);
    await push(s, human(1, { reply_to: null, author: LUNA }));
    await revokeConsent(s.relay, HUMAN, ACTOR);
    expect((await homeRead(s)).map((m) => m.author)).toEqual([expect.objectContaining({ display_name: 'Luna', username: 'luna' })]);
  });
});

describe('the live feed', () => {
  it('sends what is relayed in a home channel as the web app reads it, and nothing elsewhere or private', async () => {
    const s = await home();
    const live = liveFeed(s);
    await agree(s, HUMAN);
    await s.db
      .prepare('INSERT INTO threads (id, parent_id, name, created_at, private, updated_at) VALUES (?, ?, NULL, ?, 1, ?)')
      .bind(PRIVATE, LOUNGE, s.now().toISOString(), s.now().toISOString())
      .run();
    await post(s, msg(1), 'an agent in a home channel');
    await post(s, msg(2), 'an agent elsewhere', { channelId: BENCH });
    await post(s, msg(3), 'an agent in a private conversation', { threadId: PRIVATE });
    await push(s, human(4, { reply_to: null, author: LUNA }));

    expect(live.frames.map(told)).toEqual(['an agent in a home channel', 'message 4']);
    const read = await homeRead(s);
    expect(live.frames).toEqual([
      { type: 'message.created', at: s.now().getTime(), message: read.find((m) => m.message_id === msg(1)) },
      { type: 'message.created', at: s.now().getTime(), message: read.find((m) => m.message_id === msg(4)) },
    ]);
  });

  it('sends edits and removals, and nothing of a private conversation', async () => {
    const s = await home();
    const live = liveFeed(s);
    await agree(s, HUMAN);
    await s.db
      .prepare('INSERT INTO threads (id, parent_id, name, created_at, private, updated_at) VALUES (?, ?, NULL, ?, 1, ?)')
      .bind(PRIVATE, LOUNGE, s.now().toISOString(), s.now().toISOString())
      .run();
    await post(s, msg(1), 'unseen', { threadId: PRIVATE });
    await push(s, human(2, { reply_to: null }));
    await push(s, edit(2, 'message 2, edited', 5));
    await push(s, remove(1, { thread_id: PRIVATE }), remove(2));
    expect(live.frames.map(told)).toEqual([
      'message 2',
      { edited: 'message 2, edited' },
      { type: 'message.deleted', channel_id: LOUNGE, message_ids: [msg(2)] },
    ]);
  });

  it('shows a person as they are now on all their messages, and has open pages read again when that changes', async () => {
    const s = await home();
    await agree(s, HUMAN);
    const live = liveFeed(s);
    const as = (username: string, avatar: string) => ({ reply_to: null, author: { ...LUNA, username, avatar } });
    await push(s, human(1, as('luna', 'a_old')));
    await push(s, human(2, as('luna', 'a_old')));
    await push(s, human(3, as('lunar', 'a_new')));
    expect(live.frames.map(told)).toEqual(['message 1', 'message 2', 'message 3', CHANGED]);
    expect((await homeRead(s)).map((m) => [m.author.username, m.author.avatar_url])).toEqual(
      Array(3).fill(['lunar', `https://cdn.discordapp.com/avatars/${HUMAN}/a_new.gif?size=64`]),
    );
  });

  it('tells open pages to read again when a channel is picked or dropped, or closed to agents', async () => {
    const s = await home();
    const live = liveFeed(s);
    await updateSettings(s.relay, 'own_admin', { home_channel_ids: [] });
    expect(live.frames).toEqual([CHANGED]);
    const closed = [{ id: GUILD, type: 0, allow: '0', deny: String(Permission.VIEW_CHANNEL) }];
    await push(s, { kind: 'channel_update', channel_id: LOUNGE, guild_id: GUILD, name: 'lounge', type: 'text', overwrites: closed, slowmode_seconds: 0 });
    expect(live.frames).toEqual([CHANGED, CHANGED]);
  });

  it('opens only as a WebSocket, one count per address', async () => {
    const s = await home();
    const live = liveFeed(s);
    expect((await s.call('GET', '/v1/showcase/live')).status).toBe(426);
    expect((await s.call('GET', '/v1/showcase/live', undefined, { upgrade: 'websocket' })).status).toBe(200);
    expect(live.visitors).toEqual([expect.stringMatching(/^[0-9a-f]{64}$/)]);
  });
});

describe('a forum on the home page', () => {
  async function forum() {
    const s = await setup();
    await seedChannel(s.relay, { id: FORUM, name: 'forum', type: 'forum', access: 'post', webhookUrl: null });
    await updateSettings(s.relay, 'own_admin', { home_channel_ids: [FORUM] });
    await agree(s, HUMAN);
    return s;
  }

  /** An agent's forum post: the thread as the Gateway announces it, and its starter as the posting pipeline records it. */
  async function startPost(s: Setup, n: number, name: string) {
    await push(s, thread(msg(n), FORUM, { name, created_at: at(0, n) }));
    await post(s, msg(n), `${name}, first lines`, { channelId: FORUM, threadId: msg(n) });
  }

  const listed = async (s: Setup) =>
    ThreadPage.parse(await (await s.internal('GET', `/internal/v1/channels/${FORUM}/threads?include_archived=true&include_avatars=true`)).json()).threads;

  it('sends a reply live with its post’s ID, and the post as the threads read shows it; a removed starter shows removed', async () => {
    const s = await forum();
    await startPost(s, 1, 'a post');
    const live = liveFeed(s);
    await push(s, human(2, { channel_id: FORUM, thread_id: msg(1), reply_to: null }));
    expect(live.frames[0]).toMatchObject({ type: 'message.created', message: { thread_id: msg(1), content: 'message 2' } });
    expect(live.frames[1]).toEqual({ type: 'post.updated', post: (await listed(s))[0] });

    live.frames.length = 0;
    await push(s, remove(1, { channel_id: FORUM, thread_id: msg(1) }));
    expect(live.frames.map(told)).toEqual([
      { type: 'message.deleted', channel_id: FORUM, message_ids: [msg(1)] },
      { post: msg(1), messages: 1, starter: null },
    ]);
  });

  it('sends a post once Discord announces its thread, when the starter was recorded first', async () => {
    const s = await forum();
    const live = liveFeed(s);
    await post(s, msg(1), 'early starter', { channelId: FORUM, threadId: msg(1) });
    live.frames.length = 0;
    await push(s, thread(msg(1), FORUM, { name: 'a post', created_at: at(0, 1) }));
    expect(live.frames.map(told)).toEqual([{ post: msg(1), messages: 1, starter: 'early starter' }]);
    expect((await listed(s)).map((p) => p.name)).toEqual(['a post']);
  });
});
