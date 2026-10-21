import { EventsPage, LIMITS } from '@logitland/contracts';
import { describe, expect, it } from 'vitest';
import { human, one, push, world } from './intake-fixtures';
import { hit } from './services/limits';
import { LOUNGE, TEST_LIMITS } from './testing';

/** The agent's reads a minute: its level's, which the harness sets for every level. */
const READS = TEST_LIMITS.reads_per_minute;

async function reader() {
  const w = await world();
  const get = (path: string) => w.h.call('GET', path, undefined, w.h.as(w.agent.token));
  const key = `read:${w.agent.id}:m`;
  const used = async () => (await one<{ count: number }>(w.h, 'SELECT count FROM rate_counters WHERE key = ?', key))?.count ?? 0;
  const spend = (n: number) => hit(w.h.relay, { key, limit: READS, windowSeconds: 60 }, n);
  return { ...w, get, used, spend };
}

describe('GET /v1/events?wait=', () => {
  it('charges a call that has to wait one read for each second it waits', async () => {
    const { h, get, used } = await reader();
    await push(h, human(1));
    const started = Date.now();
    const res = await get('/v1/events?after=1&wait=2');
    expect(EventsPage.parse(await res.json())).toEqual({ events: [], next_cursor: '1' });
    expect(Date.now() - started).toBeGreaterThanOrEqual(1_900);
    expect(await used()).toBe(2);
  }, 10_000);

  it('turns a long poll away at once when the seconds it would hold are not left in the minute', async () => {
    const { h, get, spend, used } = await reader();
    await push(h, human(1));
    await spend(READS - 10);
    const started = Date.now();
    const res = await get('/v1/events?after=1&wait=25');
    expect(res.status).toBe(429);
    expect(Date.now() - started).toBeLessThan(1_000);
    expect(Number(res.headers.get('retry-after'))).toBeGreaterThan(0);
    const body = (await res.json()) as { code: string; detail: string };
    expect(body.code).toBe('rate_limited');
    expect(body.detail).toContain('every second you wait');
    expect(await used()).toBeGreaterThan(READS);
  });

  it('allows about 24 full long polls a minute: the 25th second-by-second bill no longer fits', async () => {
    const { h, get, spend } = await reader();
    await push(h, human(1));
    // 24 waits of 25 seconds are 600 reads, the whole minute. With 576 used, one more read and 24 for the wait is one too many.
    await spend(READS - LIMITS.longPollMaxSeconds + 1);
    expect((await get('/v1/events?after=1&wait=25')).status).toBe(429);
  });

  it('does not charge for waiting when there is something to return, or when it does not wait', async () => {
    const { h, get, used } = await reader();
    await push(h, human(1), human(2));
    const started = Date.now();
    expect(EventsPage.parse(await (await get('/v1/events?after=0&wait=25')).json()).events).toHaveLength(2);
    expect(Date.now() - started).toBeLessThan(1_000);
    expect(await used()).toBe(1);
    await get('/v1/events?after=2');
    expect(await used()).toBe(2);
  });

  it('looks for new events once per wait of a couple of seconds, with one cheap query', async () => {
    const { h, get } = await reader();
    await push(h, human(1));
    const sql: string[] = [];
    const real = h.relay.db;
    h.relay.db = { batch: (s) => real.batch(s), prepare: (text) => (sql.push(text), real.prepare(text)) };
    await get('/v1/events?after=1&wait=2');
    h.relay.db = real;
    // One listing at the start; afterwards only the tail is checked, and nothing came, so no second listing.
    expect(sql.filter((q) => q.includes('FROM events e WHERE'))).toHaveLength(1);
    expect(sql.filter((q) => q.includes('MAX(seq)')).length).toBeLessThanOrEqual(3);
  }, 10_000);

  it('answers a waiting call within a few seconds of an event arriving', async () => {
    const { h, get } = await reader();
    await push(h, human(1));
    const started = Date.now();
    const waiting = get('/v1/events?after=1&wait=10');
    setTimeout(() => void push(h, human(2)), 300);
    const page = EventsPage.parse(await (await waiting).json());
    expect(page.events.map((e) => e.cursor)).toEqual(['2']);
    expect(Date.now() - started).toBeLessThan(4_000);
  }, 15_000);

  it('skips events in channels the agent cannot see without answering, and keeps waiting', async () => {
    const { h, get } = await reader();
    await push(h, human(1));
    const waiting = get('/v1/events?after=1&wait=3');
    // An event the agent may not see advances the tail but is not returned.
    await h.db.prepare("UPDATE channels SET agent_access = 'off' WHERE id = ?").bind(LOUNGE).run();
    await h.db
      .prepare(
        "INSERT INTO events (id, source_key, type, guild_id, channel_id, message_id, payload, observed_at) VALUES ('evt_hidden0001', 'x:1', 'message.created', 'g', ?, NULL, '{}', ?)",
      )
      .bind(LOUNGE, h.now().toISOString())
      .run();
    const page = EventsPage.parse(await (await waiting).json());
    expect(page.events).toEqual([]);
    expect(Number(page.next_cursor)).toBeGreaterThanOrEqual(2);
  }, 10_000);
});
