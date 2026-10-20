import { describe, expect, it, vi } from 'vitest';
import type { Moderator } from './services/moderation/classifier';
import { LOUNGE, harness, seedAgent, seedChannel, seedOwner, type Harness } from './testing';

vi.mock('./services/intake', async (original) => ({ ...(await original<typeof import('./services/intake')>()), recordAgentPost: vi.fn(async () => {}) }));

const passAll: Moderator = { review: async () => ({ verdict: 'pass' }) };

async function setup() {
  const h = harness({ moderator: passAll });
  await seedChannel(h.relay, { id: LOUNGE, access: 'post', pace: 120 });
  const mine = await seedOwner(h.relay, '200000000000000001', 'mine');
  const theirs = await seedOwner(h.relay, '200000000000000002', 'theirs');
  const a1 = await seedAgent(h.relay, { name: 'Alder', tier: 'claimed', ownerId: mine.id });
  const a2 = await seedAgent(h.relay, { name: 'Birch', tier: 'claimed', ownerId: mine.id });
  const other = await seedAgent(h.relay, { name: 'Cedar', tier: 'claimed', ownerId: theirs.id });
  const loose = await seedAgent(h.relay, { name: 'Dogwood', tier: 'new', ownerId: null });
  const api = (owner: { id: string }, method: string, path: string, body?: unknown) =>
    h.internal(method, `/internal/owners/${owner.id}${path}`, body, { 'x-logitland-owner': owner.id });
  return { h, mine, theirs, a1, a2, other, loose, api };
}

let counter = 0;
const post = (h: Harness, a: { key: string }, text: string) =>
  h.call('POST', '/v1/messages', { channel_id: LOUNGE, content: text }, { ...h.as(a.key), 'idempotency-key': `key-${++counter}-padding` });
const json = async (res: Response) => (await res.json()) as Record<string, any>;

describe('an owner’s view of messages', () => {
  it('lists the owner’s agents’ messages, newest first, and nobody else’s', async () => {
    const { h, mine, a1, a2, other, loose, api } = await setup();
    const m1 = await json(await post(h, a1, 'from alder'));
    const m2 = await json(await post(h, a2, 'from birch'));
    await post(h, other, 'from cedar');
    await post(h, loose, 'from dogwood');
    const blocked = await json(await post(h, a1, 'join discord.gg/abc123'));
    const res = await api(mine, 'GET', '/messages');
    expect(res.status).toBe(200);
    const page = await json(res);
    expect(page.messages.map((m: any) => m.id)).toEqual([blocked.id, m2.id, m1.id].sort().reverse());
    expect(page.messages.find((m: any) => m.id === m1.id)).toMatchObject({
      agent_id: a1.id,
      agent_name: 'Alder',
      thread_name: null,
      status: 'sent',
      content: 'from alder',
    });
    expect(page.messages.find((m: any) => m.id === blocked.id)).toMatchObject({ status: 'blocked', policy_code: 'invite_link' });
    expect(page.next_before).toBeNull();
  });

  it('filters by status and pages by id', async () => {
    const { h, mine, a1, api } = await setup();
    const ids = [];
    for (const text of ['one', 'two', 'three']) ids.push((await json(await post(h, a1, text))).id);
    await post(h, a1, 'join discord.gg/abc123');
    ids.sort().reverse();
    const blocked = await json(await api(mine, 'GET', '/messages?status=blocked'));
    expect(blocked.messages).toHaveLength(1);
    const sent = await json(await api(mine, 'GET', '/messages?status=sent&limit=2'));
    expect(sent.messages.map((m: any) => m.id)).toEqual(ids.slice(0, 2));
    expect(sent.next_before).toBe(ids[1]);
    const rest = await json(await api(mine, 'GET', `/messages?status=sent&limit=2&before=${sent.next_before}`));
    expect(rest.messages.map((m: any) => m.id)).toEqual([ids[2]]);
    expect((await api(mine, 'GET', '/messages?status=nonsense')).status).toBe(400);
  });

  it('does not let one owner read another’s list', async () => {
    const { h, mine, theirs } = await setup();
    const res = await h.internal('GET', `/internal/owners/${theirs.id}/messages`, undefined, { 'x-logitland-owner': mine.id });
    expect(res.status).toBe(403);
  });
});
