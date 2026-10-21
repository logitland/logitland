import { ThreadPage } from '@logitland/contracts';
import { describe, expect, it } from 'vitest';
import { HUMAN, human, moreChannels, msg, push, thread, world } from './intake-fixtures';
import { BENCH, FORUM, LOUNGE, seedAgent } from './testing';

async function reader() {
  const w = await world();
  await moreChannels(w.h);
  const get = (path: string, token = w.agent.token) => w.h.call('GET', path, undefined, w.h.as(token));
  return { ...w, get };
}

describe('GET /v1/channels/:id/threads', () => {
  it('lists a channel’s threads, newest first, with their counts', async () => {
    const { h, get } = await reader();
    await push(
      h,
      human(10),
      thread(msg(10), LOUNGE, { name: 'first' }),
      human(11, { thread_id: msg(10) }),
      human(12),
      thread(msg(12), LOUNGE, { name: 'second' }),
    );
    const res = await get(`/v1/channels/${LOUNGE}/threads`);
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    const page = ThreadPage.parse(await res.json());
    expect(page.threads.map((t) => [t.id, t.name, t.message_count, t.starter_message_id])).toEqual([
      [msg(12), 'second', 0, msg(12)],
      [msg(10), 'first', 1, msg(10)],
    ]);
    expect(page.next_before).toBeNull();
  });

  it('shows a thread a person named as untitled, without the name', async () => {
    const { h, get } = await reader();
    await push(h, thread(msg(10), LOUNGE, { name: 'a person’s topic', owner_id: HUMAN }));
    const page = ThreadPage.parse(await (await get(`/v1/channels/${LOUNGE}/threads`)).json());
    expect(page.threads.map((t) => [t.id, t.name_hidden, t.name])).toEqual([[msg(10), true, 'Untitled thread']]);
    expect(JSON.stringify(page)).not.toContain('topic');
  });

  it('leaves out archived threads unless asked for them', async () => {
    const { h, get } = await reader();
    await push(h, thread(msg(10)), thread(msg(11), LOUNGE, { archived: true }));
    expect(ThreadPage.parse(await (await get(`/v1/channels/${LOUNGE}/threads`)).json()).threads.map((t) => t.id)).toEqual([msg(10)]);
    for (const flag of ['true', '1']) {
      const page = ThreadPage.parse(await (await get(`/v1/channels/${LOUNGE}/threads?include_archived=${flag}`)).json());
      expect(page.threads.map((t) => [t.id, t.archived])).toEqual([
        [msg(11), true],
        [msg(10), false],
      ]);
    }
    expect(ThreadPage.parse(await (await get(`/v1/channels/${LOUNGE}/threads?include_archived=false`)).json()).threads).toHaveLength(1);
  });

  it('pages with limit and before', async () => {
    const { h, get } = await reader();
    await push(h, thread(msg(10)), thread(msg(11)), thread(msg(12)));
    const first = ThreadPage.parse(await (await get(`/v1/channels/${LOUNGE}/threads?limit=2`)).json());
    expect(first.threads.map((t) => t.id)).toEqual([msg(12), msg(11)]);
    expect(first.next_before).toBe(msg(11));
    const second = ThreadPage.parse(await (await get(`/v1/channels/${LOUNGE}/threads?limit=2&before=${first.next_before}`)).json());
    expect(second.threads.map((t) => t.id)).toEqual([msg(10)]);
    expect(second.next_before).toBeNull();
  });

  it('works for forum channels, where every post is a thread', async () => {
    const { h, get } = await reader();
    await push(h, thread(msg(30), FORUM, { name: 'a post' }), human(30, { channel_id: FORUM, thread_id: msg(30) }));
    const page = ThreadPage.parse(await (await get(`/v1/channels/${FORUM}/threads`)).json());
    expect(page.threads).toMatchObject([{ id: msg(30), channel_id: FORUM, name: 'a post', message_count: 1, starter_message_id: msg(30) }]);
  });

  it('needs a key with the read scope, and a channel agents can use', async () => {
    const { h, get } = await reader();
    expect((await h.call('GET', `/v1/channels/${LOUNGE}/threads`)).status).toBe(401);
    const writer = await seedAgent(h.relay, { scopes: ['messages:write'] });
    expect((await get(`/v1/channels/${LOUNGE}/threads`, writer.token)).status).toBe(403);
    expect((await get(`/v1/channels/${BENCH}/threads`)).status).toBe(404);
    expect((await get('/v1/channels/119999999999999999/threads')).status).toBe(404);
  });

  it('checks the query', async () => {
    const { get } = await reader();
    expect((await get(`/v1/channels/${LOUNGE}/threads?include_archived=maybe`)).status).toBe(400);
    expect((await get(`/v1/channels/${LOUNGE}/threads?before=abc`)).status).toBe(400);
    expect((await get(`/v1/channels/${LOUNGE}/threads?limit=many`)).status).toBe(400);
  });
});
