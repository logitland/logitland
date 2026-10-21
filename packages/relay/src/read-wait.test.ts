import { EventsPage } from '@logitland/contracts';
import { describe, expect, it } from 'vitest';
import { human, one, push, world } from './intake-fixtures';
import { FORUM, LOUNGE, seedChannel } from './testing';

// A long-poll (GET /v1/events?wait=) holds the request until the agent's subscriptions have something, and costs one read
// however long it waits (#30 Q5).

async function reader() {
  const w = await world();
  const get = (path: string) => w.h.call('GET', path, undefined, w.h.as(w.agent.token));
  const page = async (path: string) => EventsPage.parse(await (await get(path)).json());
  const used = async () => (await one<{ count: number }>(w.h, 'SELECT count FROM rate_counters WHERE key = ?', `read:${w.agent.id}:m`))?.count ?? 0;
  expect((await w.h.call('POST', '/v1/subscriptions', { kind: 'channel', channel_id: LOUNGE }, w.h.as(w.agent.token))).status).toBe(201);
  return { ...w, get, page, used };
}

const texts = (p: EventsPage) => p.digests.flatMap((d) => d.events.map((e) => (e.type === 'message.created' ? e.data.content : e.type)));

describe('GET /v1/events?wait=', () => {
  it('costs one read however long it waits, and gives up with nothing when nothing comes', async () => {
    const { page, used } = await reader();
    const started = Date.now();
    expect((await page('/v1/events?wait=2')).digests).toEqual([]);
    expect(Date.now() - started).toBeGreaterThanOrEqual(1_900);
    expect(await used()).toBe(1);
  }, 10_000);

  it('answers within a few seconds of an event arriving', async () => {
    const { h, page } = await reader();
    const started = Date.now();
    const waiting = page('/v1/events?wait=10');
    setTimeout(() => void push(h, human(2)), 300);
    expect(texts(await waiting)).toEqual(['message 2']);
    expect(Date.now() - started).toBeLessThan(4_000);
  }, 15_000);

  it('does not wait when there is already something to return', async () => {
    const { h, page } = await reader();
    await push(h, human(1));
    const started = Date.now();
    expect(texts(await page('/v1/events?wait=25'))).toEqual(['message 1']);
    expect(Date.now() - started).toBeLessThan(1_000);
  });

  it('keeps waiting through events none of its subscriptions take', async () => {
    const { h, page } = await reader();
    await seedChannel(h.relay, { id: FORUM, name: 'forum', type: 'forum', webhookUrl: null });
    const waiting = page('/v1/events?wait=3');
    setTimeout(() => void push(h, human(2, { channel_id: FORUM })), 300);
    expect((await waiting).digests).toEqual([]);
    expect(await one(h, 'SELECT 1 AS recorded FROM events WHERE channel_id = ?', FORUM)).toEqual({ recorded: 1 });
  }, 10_000);

  it('checks the log with one cheap query a couple of seconds while it waits', async () => {
    const { h, get } = await reader();
    const sql: string[] = [];
    const real = h.relay.db;
    h.relay.db = { batch: (s) => real.batch(s), prepare: (text) => (sql.push(text), real.prepare(text)) };
    await get('/v1/events?wait=2');
    h.relay.db = real;
    // The subscriptions are read once at the start; afterwards only the tail is checked, and nothing came.
    expect(sql.filter((q) => q.startsWith('SELECT * FROM subscriptions'))).toHaveLength(1);
    expect(sql.filter((q) => q.includes('MAX(seq)')).length).toBeLessThanOrEqual(4);
  }, 10_000);
});
