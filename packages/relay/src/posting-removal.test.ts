import { describe, expect, it, vi } from 'vitest';
import { FORUM_ID, converse, json, post, remove, row, say, world } from './posting-fixtures';
import { UNCERTAIN_REASON } from './services/moderation/rows';
import { ADMIN_DISCORD, seedOwner } from './testing';

vi.mock('./services/intake', async (original) => ({ ...(await original<typeof import('./services/intake')>()), recordAgentPost: vi.fn(async () => {}) }));

const TEXT_COLUMNS = ['content', 'thread_name', 'reply_prefix'] as const;
const blanks = (r: Record<string, any> | null) => Object.fromEntries(TEXT_COLUMNS.map((c) => [c, r?.[c] ?? null]));
const ALL_NULL = { content: null, thread_name: null, reply_prefix: null };

/** A forum post and a reply: between them every text column is filled. */
async function filledPosts(w: Awaited<ReturnType<typeof world>>) {
  const target = await converse(w.h, { content: 'what do you all think?' });
  const reply = await json(await post(w.h, w.a, say('I think so too', { reply_to: target })));
  const thread = await json(await post(w.h, w.a, { channel_id: FORUM_ID, thread_name: 'Plans for the week', content: 'forum text' }));
  expect(await row(w.h, reply.id)).toMatchObject({ status: 'sent', content: 'I think so too' });
  expect((await row(w.h, reply.id))!.reply_prefix).toMatch(/Replying to/);
  expect(await row(w.h, thread.id)).toMatchObject({ status: 'sent', content: 'forum text', thread_name: 'Plans for the week' });
  return { reply: reply.id as string, thread: thread.id as string };
}

describe('removing a message blanks its text in the relay’s own record', () => {
  it('when its author deletes one that was posted', async () => {
    const w = await world();
    const { reply, thread } = await filledPosts(w);
    for (const id of [reply, thread]) {
      const res = await remove(w.h, w.a, id);
      expect(res.status).toBe(200);
      expect(await json(res)).toMatchObject({ status: 'removed', content: null });
      expect(blanks(await row(w.h, id))).toEqual(ALL_NULL);
      expect(await row(w.h, id)).toMatchObject({ status: 'removed', status_reason: 'Deleted by its author.' });
    }
  });

  it('when its author cancels one that was queued, held or failed', async () => {
    const handed: string[] = [];
    const w = await world({ sender: { enqueue: async (_c, id) => void handed.push(id) } });
    const queued = await json(await post(w.h, w.a, say('queued text', { thread_name: 'A thread name' })));
    const held = await json(await post(w.h, w.a, say('write to me@example.com about it')));
    const failed = await json(await post(w.h, w.a, say('failed text')));
    await w.h.db.prepare("UPDATE relay_messages SET status = 'failed' WHERE id = ?").bind(failed.id).run();
    expect([queued.status, held.status]).toEqual(['queued', 'held']);
    expect((await row(w.h, queued.id))!.thread_name).toBe('A thread name');
    for (const m of [queued, held, failed]) {
      const res = await remove(w.h, w.a, m.id);
      expect(await json(res)).toMatchObject({ status: 'removed', content: null });
      expect(blanks(await row(w.h, m.id))).toEqual(ALL_NULL);
    }
  });

  it('when a moderator takes it down, and the agent, its owner and an appeal all cope with the missing text', async () => {
    const w = await world();
    const admin = await seedOwner(w.h.relay, ADMIN_DISCORD, 'admin');
    const owner = await seedOwner(w.h.relay, '200000000000000007', 'owner');
    await w.h.db.prepare('UPDATE agents SET owner_id = ? WHERE id = ?').bind(owner.id, w.a.id).run();
    const { thread } = await filledPosts(w);
    const take = await w.h.internal(
      'POST',
      `/internal/admin/messages/${thread}/takedown`,
      { policy_code: 'spam', reason: 'Off topic' },
      { 'x-logitland-owner': admin.id },
    );
    expect(take.status).toBe(200);
    expect(blanks(await row(w.h, thread))).toEqual(ALL_NULL);
    expect(await row(w.h, thread)).toMatchObject({ status: 'removed', policy_code: 'spam' });

    const mine = await w.h.call('GET', `/v1/messages/${thread}`, undefined, w.h.as(w.a.token));
    expect(await json(mine)).toMatchObject({ id: thread, status: 'removed', content: null });

    const list = await json(await w.h.internal('GET', `/internal/owners/${owner.id}/messages`, undefined, { 'x-logitland-owner': owner.id }));
    expect(list.messages.find((m: any) => m.id === thread)).toMatchObject({ status: 'removed', content: null, thread_name: null });

    const appeal = await w.h.call(
      'POST',
      '/v1/appeals',
      { target_type: 'message', target_id: thread, message: 'This was on topic for the forum.' },
      w.h.as(w.a.token),
    );
    expect(appeal.status).toBe(201);
    const queue = await json(await w.h.internal('GET', '/internal/admin/appeals', undefined, { 'x-logitland-owner': admin.id }));
    expect(queue.appeals[0].subject).toMatchObject({ status: 'removed', content: null });
    const decided = await w.h.internal(
      'POST',
      `/internal/admin/appeals/${queue.appeals[0].id}`,
      { decision: 'overturn', response: 'Fair point, sorry.' },
      { 'x-logitland-owner': admin.id },
    );
    expect(decided.status).toBe(200);
    expect(await row(w.h, thread)).toMatchObject({ status: 'removed', content: null });
  });
});

describe('an unconfirmed send', () => {
  it('stops saying Discord didn’t confirm once the message is known to be posted', async () => {
    const w = await world();
    const sent = await json(await post(w.h, w.a, say('it did go out')));
    await w.h.db.prepare('UPDATE relay_messages SET status_reason = ? WHERE id = ?').bind(UNCERTAIN_REASON, sent.id).run();
    const mine = await json(await w.h.call('GET', `/v1/messages/${sent.id}`, undefined, w.h.as(w.a.token)));
    expect(mine).toMatchObject({ status: 'sent', status_reason: null });
    await w.h.db.prepare("UPDATE relay_messages SET status = 'uncertain' WHERE id = ?").bind(sent.id).run();
    expect((await json(await w.h.call('GET', `/v1/messages/${sent.id}`, undefined, w.h.as(w.a.token)))).status_reason).toBe(UNCERTAIN_REASON);
    expect(UNCERTAIN_REASON).not.toMatch(/in time/);
    expect(UNCERTAIN_REASON).toMatch(/answered with an error/);
  });
});

describe('validation messages say what to send', () => {
  const send = (w: Awaited<ReturnType<typeof world>>, body: Record<string, unknown>) => post(w.h, w.a, body);

  it('lists the allowed auto_archive_minutes', async () => {
    const w = await world();
    const res = await send(w, say('hello there', { thread_name: 'A thread', auto_archive_minutes: 61 }));
    expect(res.status).toBe(400);
    expect(JSON.stringify(await json(res))).toContain('auto_archive_minutes must be 60, 1440, 4320 or 10080');
  });

  it('says reply_to needs a Discord message ID, not a relay msg_ id', async () => {
    const w = await world();
    const res = await send(w, say('hello there', { reply_to: 'msg_01J00000000000000000000000' }));
    expect(res.status).toBe(400);
    const body = JSON.stringify(await json(res));
    expect(body).toContain('reply_to must be a Discord message ID');
    expect(body).toContain('msg_');
  });

  it('says how long an appeal message must be', async () => {
    const w = await world();
    const res = await w.h.call('POST', '/v1/appeals', { target_type: 'message', target_id: 'msg_x', message: 'short' }, w.h.as(w.a.token));
    expect(res.status).toBe(400);
    expect(JSON.stringify(await json(res))).toContain('at least 10 characters');
  });
});
