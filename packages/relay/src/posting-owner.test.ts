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
const ok = () => Response.json({ id: '300000000000000909', channel_id: LOUNGE, content: 'x', timestamp: new Date().toISOString(), edited_timestamp: null });

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

describe('deciding on a send Discord never confirmed', () => {
  async function uncertain() {
    const ctx = await setup();
    ctx.h.setDiscord(() => new Response('bad gateway', { status: 502 }));
    const msg = await json(await post(ctx.h, ctx.a1, 'did this land?'));
    expect(msg.status).toBe('uncertain');
    ctx.h.setDiscord(async () => ok());
    return { ...ctx, msg };
  }
  const audits = (h: Harness, action: string) =>
    h.db
      .prepare('SELECT * FROM audit_log WHERE action = ?')
      .bind(action)
      .all<Record<string, any>>()
      .then((r) => r.results);

  it('resends it, really sending it, and records the owner’s decision', async () => {
    const { h, mine, msg, api } = await uncertain();
    expect(h.discordCalls).toHaveLength(1);
    const res = await api(mine, 'POST', `/messages/${msg.id}/resolve`, { action: 'resend' });
    expect(res.status).toBe(200);
    expect(await json(res)).toMatchObject({ id: msg.id, status: 'sent', discord_message_id: '300000000000000909', agent_name: 'Alder', status_reason: null });
    expect(h.discordCalls).toHaveLength(2);
    expect(await audits(h, 'message.resent')).toEqual([expect.objectContaining({ actor_type: 'owner', actor_id: mine.id, target_id: msg.id })]);
  });

  it('can come out uncertain or queued again, depending on what Discord says now', async () => {
    const one = await uncertain();
    one.h.setDiscord(() => new Response('still bad', { status: 502 }));
    expect((await json(await one.api(one.mine, 'POST', `/messages/${one.msg.id}/resolve`, { action: 'resend' }))).status).toBe('uncertain');

    const two = await uncertain();
    two.h.setDiscord(
      () => new Response(JSON.stringify({ retry_after: 2 }), { status: 429, headers: { 'content-type': 'application/json', 'retry-after': '2' } }),
    );
    expect((await json(await two.api(two.mine, 'POST', `/messages/${two.msg.id}/resolve`, { action: 'resend' }))).status).toBe('queued');
  });

  it('accepts it as sent without sending anything', async () => {
    const { h, mine, msg, api } = await uncertain();
    const res = await api(mine, 'POST', `/messages/${msg.id}/resolve`, { action: 'accept' });
    expect(res.status).toBe(200);
    expect(await json(res)).toMatchObject({ status: 'sent', status_reason: 'Accepted by the owner as sent', discord_message_id: null });
    expect(h.discordCalls).toHaveLength(1);
    expect(await audits(h, 'message.accepted')).toHaveLength(1);
  });

  it('decides once', async () => {
    const { mine, msg, api } = await uncertain();
    expect((await api(mine, 'POST', `/messages/${msg.id}/resolve`, { action: 'accept' })).status).toBe(200);
    expect((await api(mine, 'POST', `/messages/${msg.id}/resolve`, { action: 'resend' })).status).toBe(409);
  });

  it('only resolves uncertain messages', async () => {
    const { h, mine, a1, api } = await setup();
    const sent = await json(await post(h, a1, 'plainly sent'));
    const res = await api(mine, 'POST', `/messages/${sent.id}/resolve`, { action: 'resend' });
    expect(res.status).toBe(409);
    expect((await json(res)).detail).toMatch(/Discord didn’t confirm/);
    expect(h.discordCalls).toHaveLength(1);
  });

  it('keeps one owner away from another’s messages', async () => {
    const { h, theirs, other, mine, msg, api } = await uncertain();
    expect((await api(theirs, 'POST', `/messages/${msg.id}/resolve`, { action: 'accept' })).status).toBe(404);
    const theirsUncertain = await (async () => {
      h.setDiscord(() => new Response('bad gateway', { status: 502 }));
      return json(await post(h, other, 'their uncertain one'));
    })();
    expect((await api(mine, 'POST', `/messages/${theirsUncertain.id}/resolve`, { action: 'accept' })).status).toBe(404);
    expect((await api(mine, 'POST', '/messages/msg_NOSUCHMESSAGE0/resolve', { action: 'accept' })).status).toBe(404);
  });

  it('rejects an action it does not know', async () => {
    const { mine, msg, api } = await uncertain();
    expect((await api(mine, 'POST', `/messages/${msg.id}/resolve`, { action: 'delete' })).status).toBe(400);
    expect((await api(mine, 'POST', `/messages/${msg.id}/resolve`, {})).status).toBe(400);
  });

  it('cannot reach an agent without an owner', async () => {
    const { h, mine, loose, api } = await setup();
    h.setDiscord(() => new Response('bad gateway', { status: 502 }));
    const msg = await json(await post(h, loose, 'an unclaimed agent’s uncertain one'));
    expect(msg.status).toBe('uncertain');
    expect((await api(mine, 'POST', `/messages/${msg.id}/resolve`, { action: 'accept' })).status).toBe(404);
  });
});
