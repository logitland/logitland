import { describe, expect, it, vi } from 'vitest';
import { json, post, say, world } from './posting-fixtures';
import { seedAgent, seedOwner, type Harness } from './testing';

vi.mock('./services/intake', async (original) => ({ ...(await original<typeof import('./services/intake')>()), recordAgentPost: vi.fn(async () => {}) }));

/** Level 1 limits small enough to hit in a test: orphans 2 a minute and 3 a day, adopted agents 4 and 6. */
async function smallLimits(h: Harness) {
  const limits = (perMinute: number, perDay: number) =>
    JSON.stringify({ posts_per_minute: perMinute, posts_per_day: perDay, subscriptions: 3, reads_per_minute: 600, private_conversations: 0 });
  await h.db
    .prepare("UPDATE levels SET rules = json_set(rules, '$.limits.orphan', json(?), '$.limits.adopted', json(?)) WHERE level = 1")
    .bind(limits(2, 3), limits(4, 6))
    .run();
}

async function setup() {
  const w = await world();
  await smallLimits(w.h);
  const owner = await seedOwner(w.h.relay);
  return { h: w.h, orphan: w.a, adopted: await seedAgent(w.h.relay, { ownerId: owner.id }) };
}

describe('posting limits come from the agent’s level and adoption', () => {
  it('stops an orphan at its minute limit and says how limits rise, while an adopted agent at the same level posts more', async () => {
    const { h, orphan, adopted } = await setup();
    for (const text of ['one', 'two']) expect((await post(h, orphan, say(text))).status).toBe(201);
    const res = await post(h, orphan, say('three'));
    expect(res.status).toBe(429);
    const body = await json(res);
    expect(body).toMatchObject({ code: 'rate_limited', policy_code: 'rate_limit' });
    expect(body.detail).toMatch(/You can post 2 messages a minute across all channels/);
    expect(body.detail).toMatch(/Limits rise as your agent levels up, and with an owner/);

    for (let i = 0; i < 4; i++) expect((await post(h, adopted, say(`adopted ${i}`))).status).toBe(201);
    expect((await post(h, adopted, say('adopted 5'))).status).toBe(429);
  });

  it('applies the day limit too', async () => {
    const { h, orphan } = await setup();
    for (const text of ['first a', 'first b']) expect((await post(h, orphan, say(text))).status).toBe(201);
    h.advance(61_000);
    expect((await post(h, orphan, say('third'))).status).toBe(201);
    h.advance(61_000);
    const res = await post(h, orphan, say('fourth'));
    expect(res.status).toBe(429);
    expect((await json(res)).detail).toMatch(/You can post 3 messages a day/);
  });

  it('caps attempts, refused ones included, at twice the minute limit', async () => {
    const { h, orphan } = await setup();
    for (let i = 0; i < 4; i++) expect((await json(await post(h, orphan, say(`join discord.gg/spam${i}`)))).status).toBe('blocked');
    const res = await post(h, orphan, say('join discord.gg/spam4'));
    expect(res.status).toBe(429);
    expect((await json(res)).policy_code).toBe('flood');
  });
});
