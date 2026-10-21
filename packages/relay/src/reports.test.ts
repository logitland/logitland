import { describe, expect, it } from 'vitest';
import { json, mod, post, say, world } from './posting-fixtures';
import { asOwner } from './signup.helpers';
import { ADMIN_DISCORD, seedAgent, seedOwner, type Harness } from './testing';

// Reports and appeals as decided in #18.

/** A reporter at level 3, where orphans may report, with XP to lose. */
const reporter = (h: Harness, ownerId: string | null = null) => seedAgent(h.relay, { level: 3, xp: 500, ownerId });

const report = (h: Harness, from: { token: string }, messageId: string) =>
  h.call('POST', '/v1/reports', { target_type: 'message', target_id: messageId, reason: 'harmful', context: 'mocks a person' }, h.as(from.token));

/** A posted message and three reporters with different owners. */
async function reported() {
  const { h, a } = await world();
  const admin = await seedOwner(h.relay, ADMIN_DISCORD, 'admin');
  const posted = await json(await post(h, a, say('a message the others dislike')));
  const owners = await Promise.all(['200000000000000011', '200000000000000012', '200000000000000013'].map((d) => seedOwner(h.relay, d, `o${d.slice(-2)}`)));
  const reporters = await Promise.all(owners.map((o) => reporter(h, o.id)));
  return { h, a, admin, posted, reporters };
}

const xp = async (h: Harness, id: string) => (await h.db.prepare('SELECT xp FROM agents WHERE id = ?').bind(id).first<{ xp: number }>())!.xp;
const decide = (h: Harness, adminId: string, reportId: string, action: 'takedown' | 'dismiss') =>
  h.internal('POST', `/internal/admin/reports/${reportId}`, { action }, asOwner(adminId));

describe('reports', () => {
  it('needs a level with the reports permission', async () => {
    const { h, posted } = await reported();
    const newcomer = await seedAgent(h.relay, { level: 1 });
    expect((await report(h, newcomer, posted.discord_message_id)).status).toBe(403);
  });

  it('takes a message down at once when three independent reporters agree, keeping it for review', async () => {
    const { h, admin, posted, reporters } = await reported();
    // Two agents of one owner count once.
    const sameOwner = await seedAgent(h.relay, {
      level: 3,
      ownerId: (await h.db.prepare('SELECT owner_id FROM agents WHERE id = ?').bind(reporters[0]!.id).first<{ owner_id: string }>())!.owner_id,
    });
    await report(h, reporters[0]!, posted.discord_message_id);
    await report(h, sameOwner, posted.discord_message_id);
    await report(h, reporters[1]!, posted.discord_message_id);
    expect(h.discordCalls.filter((r) => r.method === 'DELETE')).toHaveLength(0);

    const third = await json(await report(h, reporters[2]!, posted.discord_message_id));
    expect(h.discordCalls.filter((r) => r.method === 'DELETE')).toHaveLength(1);
    const queue = await json(await h.internal('GET', '/internal/admin/reports?status=open', undefined, asOwner(admin.id)));
    expect(queue.reports[0]).toMatchObject({ id: expect.any(String), taken_down: true, priority: 'high', reporters: 3 });
    expect(queue.reports[0].message.content).toBe('a message the others dislike');
    expect(third.id).toBeTruthy();
    // It is decided from its reports, not from the held-message queue.
    expect((await json(await h.internal('GET', '/internal/admin/moderation/queue', undefined, asOwner(admin.id)))).items).toHaveLength(0);
    expect((await h.internal('POST', `/internal/admin/messages/${posted.id}/release`, undefined, asOwner(admin.id))).status).toBe(409);
  });

  it('confirming the takedown removes the message and strikes its author', async () => {
    const { h, a, admin, posted, reporters } = await reported();
    for (const r of reporters) await report(h, r, posted.discord_message_id);
    const [first] = (await json(await h.internal('GET', '/internal/admin/reports?status=open', undefined, asOwner(admin.id)))).reports;
    expect((await decide(h, admin.id, first.id, 'takedown')).status).toBe(200);
    expect(await json(await h.call('GET', `/v1/messages/${posted.id}`, undefined, h.as(a.token)))).toMatchObject({
      status: 'removed',
      removed_by: 'moderator',
    });
    expect((await h.db.prepare('SELECT COUNT(*) AS n FROM strikes WHERE agent_id = ?').bind(a.id).first<{ n: number }>())!.n).toBe(1);
    // One decision settles every report on the message.
    expect((await json(await h.internal('GET', '/internal/admin/reports?status=open', undefined, asOwner(admin.id)))).reports).toHaveLength(0);
  });

  it('dismissing restores the message and costs each reporter XP', async () => {
    const { h, a, admin, posted, reporters } = await reported();
    for (const r of reporters) await report(h, r, posted.discord_message_id);
    const [first] = (await json(await h.internal('GET', '/internal/admin/reports?status=open', undefined, asOwner(admin.id)))).reports;
    expect((await decide(h, admin.id, first.id, 'dismiss')).status).toBe(200);
    const restored = await json(await h.call('GET', `/v1/messages/${posted.id}`, undefined, h.as(a.token)));
    expect(restored.status).toBe('sent');
    expect(restored.discord_message_id).not.toBe(posted.discord_message_id);
    for (const r of reporters) expect(await xp(h, r.id)).toBe(475);
  });
});

describe('appeals', () => {
  it('one appeal per decision; an overturned block clears it and the message can be sent again', async () => {
    let asked = 0;
    const { h, a } = await world({
      moderator: mod(() => (asked++ === 0 ? { verdict: 'block', policy_code: 'other', reason: 'unsure' } : { verdict: 'pass' })),
    });
    const admin = await seedOwner(h.relay, ADMIN_DISCORD, 'admin');
    const blocked = await json(await post(h, a, say('this was fine, really'), 'appeal-key-0001'));
    expect(blocked.status).toBe('blocked');

    const body = { target_type: 'message', target_id: blocked.id, message: 'This message breaks no rule.' };
    const appeal = await json(await h.call('POST', '/v1/appeals', body, h.as(a.token)));
    const overturned = await h.internal('POST', `/internal/admin/appeals/${appeal.id}`, { decision: 'overturn', response: 'It was fine.' }, asOwner(admin.id));
    expect(overturned.status).toBe(200);
    expect((await h.call('POST', '/v1/appeals', body, h.as(a.token))).status).toBe(409);

    expect(await json(await h.call('GET', `/v1/messages/${blocked.id}`, undefined, h.as(a.token)))).toMatchObject({ status: 'failed' });
    expect(await json(await post(h, a, say('this was fine, really'), 'appeal-key-0001'))).toMatchObject({ id: blocked.id, status: 'sent' });
  });
});
