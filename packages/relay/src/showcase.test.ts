import { ShowcasePage, type Showcase, type ShowcaseFrame, type Stats } from '@logitland/contracts';
import { Permission } from '@logitland/discord';
import { describe, expect, it } from 'vitest';
import { agree } from './consent.testkit';
import { say, setup, type Setup } from './deliveries.testkit';
import { at, edit, human, HUMAN, msg, push, remove, thread } from './intake-fixtures';
import { removeMessages, revokeConsent } from './services/consent';
import { recordAgentPost } from './services/intake';
import { updateSettings } from './services/settings';
import { BENCH, FORUM, GUILD, LOUNGE, seedChannel, setAccess } from './testing';

// The home page (#28): counts and the channels admins picked, only ever channels every agent can read, and the live feed
// that follows them.

const STAFF = '110000000000000099';
const AVATAR = 'https://images.orrery.dev/orrery.png';
const PRIVATE = '120000000000000001';
/** Agreed under the notice before the home page was mentioned: kept for agents, never shown on the web. */
const EARLIER = '200000000000000003';
const ACTOR = { type: 'public', id: HUMAN } as const;

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

const homeMessages = async (s: Setup) => ((await (await s.internal('GET', '/internal/showcase')).json()) as Showcase).home_channels[0]!.messages;

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
  if (f.type === 'post.updated') return { post: f.post.id, replies: f.post.replies };
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
    expect((await res.json()) as Stats).toEqual({
      agents: 1,
      messages_today: 0,
      channels: 2,
      home_channels: [
        { id: LOUNGE, name: 'lounge' },
        { id: BENCH, name: 'lab-bench' },
      ],
    });
  });

  it('shows no channels until admins pick', async () => {
    const s = await setup();
    const { home_channels } = (await (await s.call('GET', '/v1/stats')).json()) as Stats;
    expect(home_channels).toEqual([]);
  });

  it('gives the web app the picked channels’ agent messages, oldest first, however much else was said since', async () => {
    const s = await setup();
    await updateSettings(s.relay, 'own_admin', { home_channel_ids: [LOUNGE] });
    const write = (id: string, kind: 'agent' | 'human', content: string | null) =>
      s.db
        .prepare(
          'INSERT INTO conversation (message_id, channel_id, author_kind, agent_id, author_ref, display_name, content, created_at, deleted_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
        )
        .bind(
          id,
          LOUNGE,
          kind,
          kind === 'agent' ? s.agent.id : null,
          kind === 'agent' ? s.agent.id : 'p_someone',
          kind === 'agent' ? s.agent.name : 'Someone',
          content,
          s.now().toISOString(),
          content ? null : s.now().toISOString(),
        )
        .run();
    await write('320000000000000001', 'agent', 'first');
    await write('320000000000000002', 'human', 'a person who agreed to reach agents');
    await write('320000000000000003', 'agent', null);
    await write('320000000000000004', 'agent', 'second');
    // More than a showcase's worth of people's replies after the agents' last word.
    for (let i = 10; i < 50; i++) await write(`3200000000000000${i}`, 'human', `reply ${i}`);

    expect((await s.call('GET', '/internal/showcase')).status).toBe(404);
    const res = await s.internal('GET', '/internal/showcase');
    const { home_channels } = (await res.json()) as Showcase;
    expect(home_channels.map((c) => [c.name, c.messages.map((m) => m.content)])).toEqual([['lounge', ['first', 'second']]]);
  });

  it('shows people who agreed to being shown, and nobody who agreed under the notice before it', async () => {
    const s = await setup();
    await updateSettings(s.relay, 'own_admin', { home_channel_ids: [LOUNGE] });
    const NOW = '200000000000000101';
    const BEFORE = '200000000000000102';
    await agree(s, NOW);
    await agree(s, BEFORE);
    await s.db.prepare("UPDATE consents SET notice_version = '2026-10-21' WHERE discord_user_id = ?").bind(BEFORE).run();
    const write = (id: string, person: string, content: string) =>
      s.db
        .prepare(
          "INSERT INTO conversation (message_id, channel_id, author_kind, author_ref, discord_user_id, display_name, content, created_at) VALUES (?, ?, 'human', ?, ?, 'Someone', ?, ?)",
        )
        .bind(id, LOUNGE, `p_${person}`, person, content, s.now().toISOString())
        .run();
    await write('330000000000000001', NOW, 'hello agents');
    await write('330000000000000002', BEFORE, 'agreed before the home page was mentioned');
    const { home_channels } = (await (await s.internal('GET', '/internal/showcase')).json()) as Showcase;
    expect(home_channels[0]!.messages.map((m) => m.content)).toEqual(['hello agents']);
  });

  it('refuses a channel agents can’t read, and drops one that closes later', async () => {
    const s = await setup();
    await seedChannel(s.relay, { id: STAFF, name: 'staff', access: 'off' });
    await expect(updateSettings(s.relay, 'own_admin', { home_channel_ids: [STAFF] })).rejects.toMatchObject({ status: 422 });
    await updateSettings(s.relay, 'own_admin', { home_channel_ids: [LOUNGE] });
    await setAccess(s.db, LOUNGE, 'off');
    expect(((await (await s.call('GET', '/v1/stats')).json()) as Stats).home_channels).toEqual([]);
  });
});

describe('who the home page shows', () => {
  it('shows a person as Discord does, by name, username and avatar, and an agent with its own avatar', async () => {
    const s = await home();
    await s.db.prepare('UPDATE agents SET avatar_url = ? WHERE id = ?').bind(AVATAR, s.agent.id).run();
    await post(s, msg(1), 'from an agent');
    await agree(s, HUMAN);
    await push(s, human(2, { reply_to: null, author: { id: HUMAN, username: 'luna', global_name: 'Luna', avatar: 'a_1b2c', bot: false } }));
    expect((await homeMessages(s)).map((m) => m.author)).toEqual([
      expect.objectContaining({ kind: 'agent', display_name: 'Orrery', avatar_url: AVATAR }),
      expect.objectContaining({ kind: 'human', display_name: 'Luna', discord: { id: HUMAN, username: 'luna', avatar: 'a_1b2c' } }),
    ]);
  });

  it('shows a person as they are now on all their messages, after they change their username and avatar', async () => {
    const s = await home();
    await agree(s, HUMAN);
    await push(s, human(1, { reply_to: null, author: { id: HUMAN, username: 'luna', global_name: 'Luna', avatar: 'a_old', bot: false } }));
    await push(s, human(2, { reply_to: null, author: { id: HUMAN, username: 'lunar', global_name: 'Luna', avatar: 'a_new', bot: false } }));
    expect((await homeMessages(s)).map((m) => m.author.discord)).toEqual([
      { id: HUMAN, username: 'lunar', avatar: 'a_new' },
      { id: HUMAN, username: 'lunar', avatar: 'a_new' },
    ]);
  });

  it('shows an agent without its own avatar by its sigil', async () => {
    const s = await home();
    await post(s, msg(1), 'from an agent');
    expect((await homeMessages(s))[0]!.author).toMatchObject({ kind: 'agent', avatar_url: null });
  });

  it('forgets a person who withdraws: their messages, who they were, and their place on the live page', async () => {
    const s = await home();
    const live = liveFeed(s);
    await agree(s, HUMAN);
    await push(s, human(1, { reply_to: null, author: { id: HUMAN, username: 'luna', global_name: 'Luna', avatar: 'a1b2', bot: false } }));
    await revokeConsent(s.relay, HUMAN, ACTOR);
    await removeMessages(s.relay, HUMAN, ACTOR);
    expect(await homeMessages(s)).toEqual([]);
    expect(await s.db.prepare('SELECT discord_user_id, display_name FROM conversation WHERE message_id = ?').bind(msg(1)).first()).toEqual({
      discord_user_id: null,
      display_name: 'Former participant',
    });
    expect(await s.db.prepare('SELECT username, avatar FROM consents WHERE discord_user_id = ?').bind(HUMAN).first()).toEqual({ username: null, avatar: null });
    expect(live.frames.map(told)).toEqual(['message 1', CHANGED, { type: 'message.deleted', channel_id: LOUNGE, message_ids: [msg(1)] }]);
  });
});

describe('the live feed', () => {
  it('sends what the home page shows as it is relayed: agents, and people who agreed to be shown there', async () => {
    const s = await home();
    const live = liveFeed(s);
    await agree(s, HUMAN);
    await agree(s, EARLIER, { notice: '2026-10-21' });
    await s.db
      .prepare('INSERT INTO threads (id, parent_id, name, created_at, private, updated_at) VALUES (?, ?, NULL, ?, 1, ?)')
      .bind(PRIVATE, LOUNGE, s.now().toISOString(), s.now().toISOString())
      .run();
    await post(s, msg(1), 'an agent in a home channel');
    await post(s, msg(2), 'an agent elsewhere', { channelId: BENCH });
    await post(s, msg(3), 'an agent in a private conversation', { threadId: PRIVATE });
    await push(s, human(4, { reply_to: null }));
    // Kept for agents (a reply to one), but their agreement never mentioned the home page.
    await push(s, human(5, { author: { id: EARLIER, username: 'early', bot: false }, reply_to: msg(1) }));
    expect(await s.db.prepare('SELECT 1 AS kept FROM conversation WHERE message_id = ?').bind(msg(5)).first()).toEqual({ kept: 1 });

    expect(live.frames.map(told)).toEqual(['an agent in a home channel', 'message 4']);
    expect(live.frames[1]).toMatchObject({
      type: 'message.created',
      at: s.now().getTime(),
      message: { author: { kind: 'human', author_id: expect.any(String) } },
    });
  });

  it('sends edits and removals of what it showed, and nothing of a private conversation', async () => {
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

  it('tells open pages to read again when a channel is picked or dropped, closed to agents, or a person withdraws', async () => {
    const s = await home();
    const live = liveFeed(s);
    await updateSettings(s.relay, 'own_admin', { home_channel_ids: [] });
    expect(live.frames).toEqual([CHANGED]);
    const closed = [{ id: GUILD, type: 0, allow: '0', deny: String(Permission.VIEW_CHANNEL) }];
    await push(s, { kind: 'channel_update', channel_id: LOUNGE, guild_id: GUILD, name: 'lounge', type: 'text', overwrites: closed, slowmode_seconds: 0 });
    expect(live.frames).toEqual([CHANGED, CHANGED]);
    await agree(s, HUMAN);
    await revokeConsent(s.relay, HUMAN, ACTOR);
    expect(live.frames).toEqual([CHANGED, CHANGED, CHANGED]);
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
  const QUESTION = '140000000000000001';
  const SHOWCASE = '140000000000000002';

  /** A home page showing #forum, with two tags, and a person who agreed under the notice before the home page was mentioned. */
  async function forum() {
    const s = await setup();
    await seedChannel(s.relay, { id: FORUM, name: 'forum', type: 'forum', access: 'post', webhookUrl: null });
    await s.db
      .prepare('UPDATE channels SET tags = ? WHERE id = ?')
      .bind(
        JSON.stringify([
          { id: QUESTION, name: 'question', moderated: false },
          { id: SHOWCASE, name: 'showcase', moderated: false },
        ]),
        FORUM,
      )
      .run();
    await updateSettings(s.relay, 'own_admin', { home_channel_ids: [FORUM] });
    await agree(s, HUMAN);
    await agree(s, EARLIER, { notice: '2026-10-21' });
    return s;
  }

  /** An agent's forum post: the thread as the Gateway announces it, and its starter as the posting pipeline records it. */
  async function startPost(s: Setup, n: number, name: string, tags: string[] = []) {
    await push(s, thread(msg(n), FORUM, { name, applied_tags: tags, created_at: at(0, n) }));
    await recordAgentPost(s.relay, {
      discordMessageId: msg(n),
      channelId: FORUM,
      threadId: msg(n),
      agentId: s.agent.id,
      displayName: s.agent.name,
      content: `${name}, first lines`,
      relayMessageId: `rm_${n}`,
      createdAt: at(0, n),
    });
  }

  const reply = (n: number, post: number, over: Record<string, unknown> = {}) => human(n, { channel_id: FORUM, thread_id: msg(post), reply_to: null, ...over });

  const listed = async (s: Setup) => ((await (await s.internal('GET', '/internal/showcase')).json()) as Showcase).home_channels[0]!;
  const opened = (s: Setup, post: string, before?: string) => s.internal('GET', `/internal/showcase/posts/${post}${before ? `?before=${before}` : ''}`);

  it('lists its posts by latest activity, with title, tags, starter, replies and last activity', async () => {
    const s = await forum();
    await startPost(s, 1, 'older post', [SHOWCASE, QUESTION]);
    await startPost(s, 2, 'newer post');
    await push(s, reply(3, 1));
    // Kept for agents (a reply to one), but never shown on the web: not counted.
    await push(s, reply(4, 2, { author: { id: EARLIER, username: 'early', bot: false }, reply_to: msg(2) }));
    expect(await s.db.prepare('SELECT 1 AS kept FROM conversation WHERE message_id = ?').bind(msg(4)).first()).toEqual({ kept: 1 });

    const channel = await listed(s);
    expect(channel.messages).toEqual([]);
    expect(channel.posts).toEqual([
      {
        id: msg(1),
        channel_id: FORUM,
        name: 'older post',
        tags: ['question', 'showcase'],
        starter: expect.objectContaining({
          message_id: msg(1),
          content: 'older post, first lines',
          author: expect.objectContaining({ kind: 'agent', display_name: 'Orrery' }),
        }),
        replies: 1,
        last_activity_at: at(0, 3),
      },
      expect.objectContaining({ id: msg(2), name: 'newer post', tags: [], replies: 0, last_activity_at: at(0, 2) }),
    ]);
  });

  it('lists a post only while its starter is shown, and never a private conversation', async () => {
    const s = await forum();
    await startPost(s, 1, 'kept');
    await startPost(s, 2, 'starter removed');
    await push(s, reply(3, 2), remove(2, { channel_id: FORUM, thread_id: msg(2) }));
    await s.db
      .prepare('INSERT INTO threads (id, parent_id, name, created_at, private, updated_at) VALUES (?, ?, ?, ?, 1, ?)')
      .bind(PRIVATE, FORUM, 'private', at(0, 4), at(0, 4))
      .run();
    await post(s, PRIVATE, 'in a private conversation', { channelId: FORUM, threadId: PRIVATE });
    expect((await listed(s)).posts!.map((p) => p.name)).toEqual(['kept']);
    expect((await opened(s, msg(2))).status).toBe(404);
    expect((await opened(s, PRIVATE)).status).toBe(404);
  });

  it('opens a post through the same filter, the latest page first, and nothing off the home page', async () => {
    const s = await forum();
    await startPost(s, 1, 'long thread');
    for (let n = 2; n <= 32; n++) await push(s, reply(n, 1));
    await push(s, reply(33, 1, { author: { id: EARLIER, username: 'early', bot: false }, reply_to: msg(1) }));

    const latest = ShowcasePage.parse(await (await opened(s, msg(1))).json());
    expect(latest.messages.map((m) => m.content)).toEqual(Array.from({ length: 30 }, (_, i) => `message ${i + 3}`));
    expect(latest.messages[0]!.author).toMatchObject({ kind: 'human', display_name: 'Luna' });
    const older = ShowcasePage.parse(await (await opened(s, msg(1), latest.next_before!)).json());
    expect(older).toEqual({
      messages: [expect.objectContaining({ content: 'long thread, first lines' }), expect.objectContaining({ content: 'message 2' })],
      next_before: null,
    });

    await updateSettings(s.relay, 'own_admin', { home_channel_ids: [LOUNGE] });
    expect((await opened(s, msg(1))).status).toBe(404);
  });

  it('sends a reply live with its post’s ID, and the post’s card as it now reads; a removed post leaves the list', async () => {
    const s = await forum();
    await startPost(s, 1, 'a post');
    const live = liveFeed(s);
    await push(s, reply(2, 1));
    expect(live.frames[0]).toMatchObject({ type: 'message.created', message: { thread_id: msg(1), content: 'message 2' } });
    expect(live.frames.slice(1).map(told)).toEqual([{ post: msg(1), replies: 1 }]);

    live.frames.length = 0;
    await push(s, remove(1, { channel_id: FORUM, thread_id: msg(1) }));
    expect(live.frames.map(told)).toEqual([
      { type: 'message.deleted', channel_id: FORUM, message_ids: [msg(1)] },
      { type: 'post.removed', channel_id: FORUM, post_id: msg(1) },
    ]);
  });

  it('sends a post’s card once Discord announces its thread, when the starter was recorded first', async () => {
    const s = await forum();
    const live = liveFeed(s);
    await post(s, msg(1), 'early starter', { channelId: FORUM, threadId: msg(1) });
    live.frames.length = 0;
    await push(s, thread(msg(1), FORUM, { name: 'a post', created_at: at(0, 1) }));
    expect(live.frames.map(told)).toEqual([{ post: msg(1), replies: 0 }]);
    expect((await listed(s)).posts!.map((p) => p.name)).toEqual(['a post']);
  });
});
