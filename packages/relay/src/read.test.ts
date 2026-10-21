import { ChannelList, ConversationPage, EventsPage, ExpiredCursorProblem } from '@logitland/contracts';
import { describe, expect, it } from 'vitest';
import { AGENT_POST, at, edit, human, msg, push, remove, world } from './intake-fixtures';
import { recordAgentPost } from './services/intake';
import { hit } from './services/limits';
import { BENCH, FORUM, LOUNGE, TEST_LIMITS, seedAgent, seedChannel, setAccess } from './testing';

const DAY = 86_400_000;

/** Records events in #bench while it is open, then closes it to agents. */
async function closeBenchAfter(h: Awaited<ReturnType<typeof reader>>['h'], ...events: unknown[]) {
  await setAccess(h.db, BENCH, 'read_only');
  await push(h, ...events);
  await setAccess(h.db, BENCH, 'off');
}

async function reader() {
  const w = await world();
  const get = (path: string) => w.h.call('GET', path, undefined, w.h.as(w.agent.token));
  const json = async <T>(path: string): Promise<T> => (await get(path)).json() as Promise<T>;
  return { ...w, get, json };
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
  it('starts from now without a cursor, and returns the tail as the next one', async () => {
    const { h, json } = await reader();
    await push(h, human(1), human(2));
    const page = EventsPage.parse(await json('/v1/events'));
    expect(page.events).toEqual([]);
    expect(page.next_cursor).toBe('2');
    await push(h, human(3));
    const next = EventsPage.parse(await json(`/v1/events?after=${page.next_cursor}`));
    expect(next.events.map((e) => [e.type, e.cursor])).toEqual([['message.created', '3']]);
  });

  it('returns events after a cursor, oldest first, with their cursors, only from channels open to agents', async () => {
    const { h, json } = await reader();
    await closeBenchAfter(h, human(1), human(2, { channel_id: BENCH }), edit(1, 'one, edited', 5), remove(1));
    expect(await h.db.prepare('SELECT COUNT(*) AS n FROM events').first()).toEqual({ n: 4 });
    const page = EventsPage.parse(await json('/v1/events?after=0'));
    expect(page.events.map((e) => [e.type, e.cursor, e.channel_id])).toEqual([
      ['message.created', '1', LOUNGE],
      ['message.updated', '3', LOUNGE],
      ['message.deleted', '4', LOUNGE],
    ]);
    expect(page.next_cursor).toBe('4');
    const first = page.events[0]!;
    expect(first.type === 'message.created' && first.data.content).toBe('');
  });

  it('serves event data as the relay recorded it', async () => {
    const { h, json } = await reader();
    await push(h, human(1), edit(1, 'one, edited', 5));
    const page = EventsPage.parse(await json('/v1/events?after=0'));
    const [created, updated] = page.events;
    expect(created).toMatchObject({
      type: 'message.created',
      data: { message_id: msg(1), content: 'message 1', author: { kind: 'human', display_name: 'Luna' } },
    });
    expect(updated).toMatchObject({ type: 'message.updated', data: { message_id: msg(1), content: 'one, edited', edited_at: at(5) } });
  });

  it('pages with limit, and moves the cursor past events the agent cannot see', async () => {
    const { h, json } = await reader();
    await closeBenchAfter(h, human(1), human(2), human(3), human(4, { channel_id: BENCH }), human(5, { channel_id: BENCH }));
    const first = EventsPage.parse(await json('/v1/events?after=0&limit=2'));
    expect(first.events.map((e) => e.cursor)).toEqual(['1', '2']);
    expect(first.next_cursor).toBe('2');
    const second = EventsPage.parse(await json(`/v1/events?after=${first.next_cursor}&limit=2`));
    expect(second.events.map((e) => e.cursor)).toEqual(['3']);
    // A short page has scanned everything up to the newest event, including the two the agent can't see.
    expect(second.next_cursor).toBe('5');
    const empty = EventsPage.parse(await json('/v1/events?after=5'));
    expect(empty).toEqual({ events: [], next_cursor: '5' });
  });

  it('filters by channel and checks the channel and the cursor', async () => {
    const { h, json, get } = await reader();
    await seedChannel(h.relay, { id: FORUM, name: 'forum', type: 'forum', access: 'read_only', webhookUrl: null });
    await push(h, human(1), human(2, { channel_id: FORUM }));
    const page = EventsPage.parse(await json(`/v1/events?after=0&channel_id=${FORUM}`));
    expect(page.events.map((e) => e.channel_id)).toEqual([FORUM]);
    expect((await get(`/v1/events?channel_id=${BENCH}`)).status).toBe(404);
    expect((await get('/v1/events?channel_id=nope')).status).toBe(400);
    expect((await get('/v1/events?after=latest')).status).toBe(400);
    expect((await get('/v1/events?after=-1')).status).toBe(400);
    expect((await get('/v1/events?wait=soon')).status).toBe(400);
  });

  it('needs the read scope', async () => {
    const { h } = await reader();
    const writer = await seedAgent(h.relay, { scopes: ['messages:write'] });
    expect((await h.call('GET', '/v1/events', undefined, h.as(writer.token))).status).toBe(403);
  });

  it('long-polls: answers as soon as an event lands', async () => {
    const { h, get } = await reader();
    await push(h, human(1));
    const started = Date.now();
    const waiting = get('/v1/events?after=1&wait=10');
    setTimeout(() => void push(h, human(2)), 200);
    const res = await waiting;
    const page = EventsPage.parse(await res.json());
    expect(page.events.map((e) => [e.type, e.cursor])).toEqual([['message.created', '2']]);
    expect(Date.now() - started).toBeLessThan(4_000);
  }, 15_000);

  it('long-polls: gives up with an empty page when nothing happens, keeping the cursor', async () => {
    const { h, get } = await reader();
    await push(h, human(1));
    const started = Date.now();
    const res = await get('/v1/events?after=1&wait=1');
    expect(EventsPage.parse(await res.json())).toEqual({ events: [], next_cursor: '1' });
    expect(Date.now() - started).toBeGreaterThanOrEqual(900);
    expect(Date.now() - started).toBeLessThan(3_000);
  }, 10_000);

  it('does not wait when there is already something to return', async () => {
    const { h, get } = await reader();
    await push(h, human(1));
    const started = Date.now();
    const res = await get('/v1/events?after=0&wait=25');
    expect(EventsPage.parse(await res.json()).events).toHaveLength(1);
    expect(Date.now() - started).toBeLessThan(1_000);
  });
});

describe('an expired cursor', () => {
  it('is answered 410 with where to resume, once the event text it points at is gone', async () => {
    const { h, get } = await reader();
    await push(h, human(1), human(2));
    h.advance(40 * DAY);
    await push(h, human(3), human(4));
    const stale = await get('/v1/events?after=0');
    expect(stale.status).toBe(410);
    expect(stale.headers.get('content-type')).toContain('application/problem+json');
    const problem = ExpiredCursorProblem.parse(await stale.json());
    expect(problem.code).toBe('expired');
    expect(problem.oldest_cursor).toBe('2');
    expect(problem.detail).toContain('GET /v1/channels/:id/messages');
    expect(problem.detail).toContain('after=2');
    expect((await get('/v1/events?after=1')).status).toBe(410);

    const resumed = EventsPage.parse(await (await get(`/v1/events?after=${problem.oldest_cursor}`)).json());
    expect(resumed.events.map((e) => e.cursor)).toEqual(['3', '4']);
  });

  it('is not raised for a cursor that is already up to date, however old the events behind it are', async () => {
    const { h, get } = await reader();
    await push(h, human(1), human(2));
    h.advance(40 * DAY);
    expect((await get('/v1/events?after=2')).status).toBe(200);
  });

  it('points past everything when no event is fresh', async () => {
    const { h, get } = await reader();
    await push(h, human(1), human(2));
    h.advance(40 * DAY);
    const stale = await get('/v1/events?after=0');
    expect(ExpiredCursorProblem.parse(await stale.json()).oldest_cursor).toBe('2');
  });
});
