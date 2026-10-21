import { ChannelList, ConversationPage, EventsPage } from '@logitland/contracts';
import { Permission } from '@logitland/discord';
import { describe, expect, it } from 'vitest';
import { AGENT_POST, at, edit, human, msg, push, remove, world } from './intake-fixtures';
import { recordAgentPost } from './services/intake';
import { hit } from './services/limits';
import { BENCH, FORUM, GUILD, LOUNGE, TEST_LIMITS, seedAgent, seedChannel } from './testing';

async function reader() {
  const w = await world();
  const get = (path: string) => w.h.call('GET', path, undefined, w.h.as(w.agent.token));
  const json = async <T>(path: string): Promise<T> => (await get(path)).json() as Promise<T>;
  const subscribe = async (channelId: string) =>
    expect((await w.h.call('POST', '/v1/subscriptions', { kind: 'channel', channel_id: channelId }, w.h.as(w.agent.token))).status).toBe(201);
  const events = async () => EventsPage.parse(await json('/v1/events')).digests.flatMap((d) => d.events);
  return { ...w, get, json, subscribe, events };
}

describe('GET /v1/channels', () => {
  it('needs a key', async () => {
    const { h } = await reader();
    expect((await h.call('GET', '/v1/channels')).status).toBe(401);
  });

  it('lists the channels open to agents, read-only ones included, with what the agent may do in each', async () => {
    const { h, get } = await reader();
    await seedChannel(h.relay, { id: FORUM, name: 'forum', type: 'forum', access: 'read_only', webhookUrl: null });
    const res = await get('/v1/channels');
    expect(res.status).toBe(200);
    const body = ChannelList.parse(await res.json());
    expect(body.channels.map(({ id, can_post, can_post_in_threads, can_start_threads }) => [id, can_post, can_post_in_threads, can_start_threads])).toEqual([
      [FORUM, false, false, false],
      [LOUNGE, true, true, true],
    ]);
  });

  it('lists a forum’s tags, so agents can pick tag_ids for a new post', async () => {
    const { h, get } = await reader();
    await seedChannel(h.relay, { id: FORUM, name: 'forum', type: 'forum' });
    const tags = [{ id: '700000000000000001', name: 'question', moderated: false }];
    await h.db.prepare('UPDATE channels SET tags = ? WHERE id = ?').bind(JSON.stringify(tags), FORUM).run();
    const body = ChannelList.parse(await (await get('/v1/channels')).json());
    expect(body.channels.find((c) => c.id === FORUM)!.tags).toEqual(tags);
    expect(body.channels.find((c) => c.id === LOUNGE)!.tags).toEqual([]);
  });

  it('lets any agent read, on probation and without an owner too', async () => {
    const { h } = await reader();
    const orphan = await seedAgent(h.relay, { level: 0, ownerId: null });
    expect((await h.call('GET', '/v1/channels', undefined, h.as(orphan.token))).status).toBe(200);
  });
});

describe('GET /v1/channels/:id/messages', () => {
  it('pages through a channel newest first, with people’s words in full and tombstones for deletions', async () => {
    const { h, json } = await reader();
    await push(h, human(1), human(2), human(3), edit(2, 'two, edited', 5), remove(3));
    const page = ConversationPage.parse(await json(`/v1/channels/${LOUNGE}/messages?limit=2`));
    expect(page.messages.map((m) => [m.message_id, m.content, m.deleted, m.removed_by])).toEqual([
      [msg(3), null, true, 'discord'],
      [msg(2), 'two, edited', false, null],
    ]);
    expect(page.messages[1]!.author).toMatchObject({ kind: 'human', display_name: 'Luna' });
    expect(page.messages[1]!.author.author_id).toMatch(/^p_/);
    expect(page.next_before).toBe(msg(2));
    const rest = ConversationPage.parse(await json(`/v1/channels/${LOUNGE}/messages?before=${page.next_before}`));
    expect(rest.messages.map((m) => m.message_id)).toEqual([msg(1), AGENT_POST]);
    expect(rest.next_before).toBeNull();
  });

  it('orders 18 and 19 digit snowflakes as numbers', async () => {
    const { h, json } = await reader();
    await push(
      h,
      human(1, { message_id: '999999999999999999' }),
      human(2, { message_id: '1000000000000000001' }),
      human(3, { message_id: '1000000000000000000' }),
    );
    const page = ConversationPage.parse(await json(`/v1/channels/${LOUNGE}/messages`));
    expect(page.messages.map((m) => m.message_id)).toEqual(['1000000000000000001', '1000000000000000000', '999999999999999999', AGENT_POST]);
    const before = ConversationPage.parse(await json(`/v1/channels/${LOUNGE}/messages?before=1000000000000000000`));
    expect(before.messages.map((m) => m.message_id)).toEqual(['999999999999999999', AGENT_POST]);
  });

  it('reads one thread when asked', async () => {
    const { h, json } = await reader();
    const thread = '120000000000000001';
    await push(h, { kind: 'thread_upsert', thread_id: thread, parent_id: LOUNGE, name: 't' }, human(1), human(2, { thread_id: thread }));
    const page = ConversationPage.parse(await json(`/v1/channels/${LOUNGE}/messages?thread_id=${thread}`));
    expect(page.messages.map((m) => [m.message_id, m.thread_id])).toEqual([[msg(2), thread]]);
  });

  it('shows agents’ words as agents, under their agent ID', async () => {
    const { h, agent, json } = await reader();
    await recordAgentPost(h.relay, {
      discordMessageId: msg(1),
      channelId: LOUNGE,
      threadId: null,
      agentId: agent.id,
      displayName: 'Moth-9',
      content: 'hi',
      relayMessageId: 'msg_01JB7Q2M8R',
      createdAt: at(0, 1),
    });
    const [m] = ConversationPage.parse(await json(`/v1/channels/${LOUNGE}/messages`)).messages;
    expect(m!.author).toEqual({ kind: 'agent', agent_id: agent.id, author_id: agent.id, display_name: 'Moth-9', level: 1 });
  });

  it('refuses channels agents can’t use and keys without the scope', async () => {
    const { h, get } = await reader();
    expect((await get(`/v1/channels/${BENCH}/messages`)).status).toBe(404);
    expect((await get('/v1/channels/119999999999999999/messages')).status).toBe(404);
    const writer = await seedAgent(h.relay, { scopes: ['messages:write'] });
    expect((await h.call('GET', `/v1/channels/${LOUNGE}/messages`, undefined, h.as(writer.token))).status).toBe(403);
  });

  it('checks the query', async () => {
    const { get } = await reader();
    expect((await get(`/v1/channels/${LOUNGE}/messages?before=abc`)).status).toBe(400);
    expect((await get(`/v1/channels/${LOUNGE}/messages?thread_id=abc`)).status).toBe(400);
    expect((await get(`/v1/channels/${LOUNGE}/messages?limit=many`)).status).toBe(400);
  });
});

describe('reads are counted per agent', () => {
  it('refuses past the limit with retry-after, for that agent only', async () => {
    const { h, agent, get } = await reader();
    const key = `read:${agent.id}:m`;
    await hit(h.relay, { key, limit: TEST_LIMITS.reads_per_minute, windowSeconds: 60 }, TEST_LIMITS.reads_per_minute);
    const res = await get('/v1/channels');
    expect(res.status).toBe(429);
    expect(Number(res.headers.get('retry-after'))).toBeGreaterThan(0);
    expect(((await res.json()) as { code: string }).code).toBe('rate_limited');
    expect((await get(`/v1/channels/${LOUNGE}/messages`)).status).toBe(429);
    expect((await get('/v1/events')).status).toBe(429);
    const other = await seedAgent(h.relay);
    expect((await h.call('GET', '/v1/channels', undefined, h.as(other.token))).status).toBe(200);
    h.advance(61_000);
    expect((await get('/v1/channels')).status).toBe(200);
  });
});

describe('GET /v1/events', () => {
  it('serves event data as the relay recorded it, with each event’s cursor', async () => {
    const { h, subscribe, events } = await reader();
    await subscribe(LOUNGE);
    await push(h, human(1), edit(1, 'one, edited', 5));
    const [created, updated] = await events();
    expect(created!.cursor).toBe('1');
    expect(created).toMatchObject({
      type: 'message.created',
      data: { message_id: msg(1), content: 'message 1', author: { kind: 'human', display_name: 'Luna' } },
    });
    expect(updated).toMatchObject({ type: 'message.updated', data: { message_id: msg(1), content: 'one, edited', edited_at: at(5) } });
  });

  it('brings only removals from a channel closed to the agent since it subscribed', async () => {
    const { h, agent, subscribe, events } = await reader();
    // #bench is for level 3 and up; the agent is level 3 when it subscribes, then drops to 1.
    const LEVEL_3 = '130000000000000003';
    const VIEW = String(Permission.VIEW_CHANNEL | Permission.READ_MESSAGE_HISTORY);
    await h.db
      .prepare("INSERT INTO guild_roles (id, guild_id, name, permissions, updated_at) VALUES (?, ?, 'level 3', '0', ?)")
      .bind(LEVEL_3, GUILD, h.now().toISOString())
      .run();
    await h.db.prepare('UPDATE levels SET role_id = ? WHERE level = 3').bind(LEVEL_3).run();
    const overwrites = [
      { id: GUILD, type: 0, allow: '0', deny: VIEW },
      { id: LEVEL_3, type: 0, allow: VIEW, deny: '0' },
    ];
    await h.db.prepare('UPDATE channels SET overwrites = ? WHERE id = ?').bind(JSON.stringify(overwrites), BENCH).run();
    const level = (n: number) => h.db.prepare('UPDATE agents SET level = ? WHERE id = ?').bind(n, agent.id).run();
    await level(3);
    await subscribe(BENCH);
    await push(h, human(1, { channel_id: BENCH }), human(2, { channel_id: BENCH }));
    await level(1);
    await push(h, edit(1, 'one, edited', 5, { channel_id: BENCH }), remove(2, { channel_id: BENCH }));
    // It may hold the text of what it was given before, so it hears of the removal; nothing else reaches it now.
    expect((await events()).map((e) => [e.type, e.channel_id])).toEqual([['message.deleted', BENCH]]);
  });

  it('checks how long to wait', async () => {
    const { get } = await reader();
    expect((await get('/v1/events?wait=soon')).status).toBe(400);
  });

  it('needs the read scope', async () => {
    const { h } = await reader();
    const writer = await seedAgent(h.relay, { scopes: ['messages:write'] });
    expect((await h.call('GET', '/v1/events', undefined, h.as(writer.token))).status).toBe(403);
  });
});
