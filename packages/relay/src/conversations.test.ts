import type { Conversation, ConversationPage, EventsPage, ThreadPage } from '@logitland/contracts';
import { describe, expect, it } from 'vitest';
import { agree } from './consent.testkit';
import { push } from './intake-fixtures';
import { asOwner, count } from './signup.helpers';
import { ADMIN_DISCORD, LOUNGE, harness, seedAgent, seedChannel, seedOwner, type Harness } from './testing';

// Private conversations (#33): a private thread only its member agents (and, in Discord, their owners) can see.

const OWNER_A = '200000000000000011';
const OWNER_B = '200000000000000012';
/** Level 3 is the first seeded level whose orphans may open private conversations. */
const ALLOWED = 3;

async function world() {
  const h = harness();
  await seedChannel(h.relay, { id: LOUNGE });
  const ownerA = await seedOwner(h.relay, OWNER_A, 'ada');
  const ownerB = await seedOwner(h.relay, OWNER_B, 'bo');
  const a = await seedAgent(h.relay, { name: 'Atlas', level: ALLOWED, ownerId: ownerA.id });
  const b = await seedAgent(h.relay, { name: 'Borealis', level: ALLOWED, ownerId: ownerB.id });
  const outsider = await seedAgent(h.relay, { name: 'Cirrus', level: ALLOWED });
  return { h, a, b, outsider };
}

const discordCalls = (h: Harness) => h.discordCalls.map((r) => `${r.method} ${new URL(r.url).pathname.replace('/api/v10', '')}`);

async function open(h: Harness, token: string, invite: string[]): Promise<Conversation> {
  const res = await h.call('POST', '/v1/conversations', { channel_id: LOUNGE, invite }, h.as(token));
  expect(res.status).toBe(201);
  return (await res.json()) as Conversation;
}

/** A message in the conversation, through intake as the Gateway would deliver it. */
const inThread = (thread: string, id: string, author: Record<string, unknown>, content: string, at: string) =>
  ({ kind: 'message_create', channel_id: LOUNGE, thread_id: thread, message_id: id, author, content, timestamp: at }) as const;
const bot = { id: '200000000000000050', username: 'newsbot', bot: true };

const events = async (h: Harness, token: string) =>
  ((await (await h.call('GET', '/v1/events', undefined, h.as(token))).json()) as EventsPage).digests.flatMap((d) => d.events);

describe('private conversations', () => {
  it('open a private thread whose invitee joins only by accepting, with each joined agent’s owner added in Discord', async () => {
    const { h, a, b } = await world();
    await h.call('POST', '/v1/subscriptions', { kind: 'replies' }, h.as(b.token));
    const conv = await open(h, a.token, [b.id]);

    expect(conv).toMatchObject({ channel_id: LOUNGE, name: 'Atlas, Borealis', opened_by: a.id, archived: false });
    expect(conv.members).toEqual([
      { agent_id: a.id, name: 'Atlas', status: 'joined', invited_by: null },
      { agent_id: b.id, name: 'Borealis', status: 'invited', invited_by: a.id },
    ]);
    const created = h.discordCalls.find((r) => new URL(r.url).pathname.endsWith(`/channels/${LOUNGE}/threads`))!;
    expect(await created.json()).toMatchObject({ type: 12, invitable: false });
    expect(discordCalls(h)).toContain(`PUT /channels/${conv.id}/thread-members/${OWNER_A}`);
    expect(discordCalls(h)).not.toContain(`PUT /channels/${conv.id}/thread-members/${OWNER_B}`);

    expect(await events(h, b.token)).toEqual([
      expect.objectContaining({
        type: 'conversation.invited',
        data: { conversation_id: conv.id, name: 'Atlas, Borealis', invited_by: { agent_id: a.id, name: 'Atlas' } },
      }),
    ]);
    expect((await h.call('GET', `/v1/conversations/${conv.id}/messages`, undefined, h.as(b.token))).status).toBe(404);

    expect((await h.call('POST', `/v1/conversations/${conv.id}/accept`, undefined, h.as(b.token))).status).toBe(200);
    expect(discordCalls(h)).toContain(`PUT /channels/${conv.id}/thread-members/${OWNER_B}`);
    expect((await h.call('GET', `/v1/conversations/${conv.id}/messages`, undefined, h.as(b.token))).status).toBe(200);
  });

  it('reach only their members: other agents can’t list, read, subscribe to or post in them', async () => {
    const { h, a, b, outsider } = await world();
    const conv = await open(h, a.token, [b.id]);
    await h.call('POST', `/v1/conversations/${conv.id}/accept`, undefined, h.as(b.token));
    await h.call('POST', '/v1/subscriptions', { kind: 'conversation' }, h.as(b.token));
    await h.call('POST', '/v1/subscriptions', { kind: 'channel', channel_id: LOUNGE }, h.as(outsider.token));
    await h.call('POST', '/v1/subscriptions', { kind: 'conversation' }, h.as(outsider.token));

    await push(h, inThread(conv.id, '300000000000000101', bot, 'just between us', h.now().toISOString()));
    const posted = await h.call(
      'POST',
      '/v1/messages',
      { channel_id: LOUNGE, thread_id: conv.id, content: 'agreed' },
      { ...h.as(a.token), 'idempotency-key': 'conv-post-0001' },
    );
    expect(posted.status).toBe(201);

    expect((await events(h, b.token)).map((e) => e.type === 'message.created' && e.data.content)).toEqual(['just between us', 'agreed']);
    expect(await events(h, outsider.token)).toEqual([]);
    const page = (await (await h.call('GET', `/v1/channels/${LOUNGE}/messages`, undefined, h.as(outsider.token))).json()) as ConversationPage;
    expect(page.messages).toEqual([]);
    const threads = (await (await h.call('GET', `/v1/channels/${LOUNGE}/threads?include_archived=true`, undefined, h.as(outsider.token))).json()) as ThreadPage;
    expect(threads.threads).toEqual([]);
    expect(await (await h.call('GET', '/v1/conversations', undefined, h.as(outsider.token))).json()).toEqual({ conversations: [] });
    expect((await h.call('GET', `/v1/conversations/${conv.id}/messages`, undefined, h.as(outsider.token))).status).toBe(404);
    const intruding = await h.call(
      'POST',
      '/v1/messages',
      { channel_id: LOUNGE, thread_id: conv.id, content: 'hello?' },
      { ...h.as(outsider.token), 'idempotency-key': 'conv-post-0002' },
    );
    expect(intruding.status).toBe(400);
    const report = await h.call('POST', '/v1/reports', { target_type: 'message', target_id: '300000000000000101', reason: 'spam' }, h.as(outsider.token));
    expect(report.status).toBe(404);
  });

  it('relay a person only when they consented and own one of the joined agents', async () => {
    const { h, a, b } = await world();
    const conv = await open(h, a.token, [b.id]);
    await agree(h, OWNER_A);
    await agree(h, '200000000000000013');
    const at = h.now().toISOString();
    await push(
      h,
      inThread(conv.id, '300000000000000201', { id: OWNER_A, username: 'ada', bot: false }, 'from the owner', at),
      // Bo owns an agent that hasn't accepted yet, and hasn't consented.
      inThread(conv.id, '300000000000000202', { id: OWNER_B, username: 'bo', bot: false }, 'from an outside owner', at),
      // Agreed, but owns no agent here (a moderator who can see every thread, say).
      inThread(conv.id, '300000000000000203', { id: '200000000000000013', username: 'mod', bot: false }, 'from a moderator', at),
    );
    const page = (await (await h.call('GET', `/v1/conversations/${conv.id}/messages`, undefined, h.as(a.token))).json()) as ConversationPage;
    expect(page.messages.map((m) => [m.author.kind, m.content])).toEqual([['human', 'from the owner']]);
  });

  it('let probation agents accept an invitation and post without permission or room to start one', async () => {
    const { h, a } = await world();
    await h.relay.db.prepare("UPDATE levels SET rules = json_set(rules, '$.limits.private_conversations', 0) WHERE level = 0").run();
    const low = await seedAgent(h.relay, { name: 'Newcomer', level: 0 });
    const conv = await open(h, a.token, [low.id]);
    expect((await h.call('POST', `/v1/conversations/${conv.id}/accept`, undefined, h.as(low.token))).status).toBe(200);
    const posted = await h.call(
      'POST',
      '/v1/messages',
      { channel_id: LOUNGE, thread_id: conv.id, content: 'Hello everyone' },
      { ...h.as(low.token), 'idempotency-key': 'probation-conv-post' },
    );
    expect(posted.status).toBe(201);
  });

  it('need the level’s permission to start a conversation', async () => {
    const { h, b } = await world();
    const low = await seedAgent(h.relay, { name: 'Lowly', level: 1 });
    const refused = await h.call('POST', '/v1/conversations', { channel_id: LOUNGE, invite: [b.id] }, h.as(low.token));
    expect(refused.status).toBe(403);
    expect(h.discordCalls).toHaveLength(0);
  });

  it('cap only conversations started and still open, allowing invitations even at the cap', async () => {
    const { h, a, b, outsider } = await world();
    const invited = await open(h, b.token, [a.id]);
    expect((await h.call('POST', `/v1/conversations/${invited.id}/accept`, undefined, h.as(a.token))).status).toBe(200);
    const first = await open(h, a.token, [b.id]);
    await open(h, a.token, [outsider.id]);
    const third = await h.call('POST', '/v1/conversations', { channel_id: LOUNGE, invite: [b.id] }, h.as(a.token));
    expect(third.status).toBe(409);
    const another = await open(h, outsider.token, [a.id]);
    expect((await h.call('POST', `/v1/conversations/${another.id}/accept`, undefined, h.as(a.token))).status).toBe(200);
    expect((await h.call('POST', `/v1/conversations/${first.id}/leave`, undefined, h.as(a.token))).status).toBe(204);
    const replacement = await open(h, a.token, [b.id]);
    await h.relay.db.prepare('UPDATE threads SET deleted_at = ? WHERE id = ?').bind(h.now().toISOString(), replacement.id).run();
    await open(h, a.token, [b.id]);
  });

  it('take owners out as their agents leave, and archive the thread when the last agent leaves', async () => {
    const { h, a, b } = await world();
    const conv = await open(h, a.token, [b.id]);
    await h.call('POST', `/v1/conversations/${conv.id}/accept`, undefined, h.as(b.token));

    expect((await h.call('POST', `/v1/conversations/${conv.id}/leave`, undefined, h.as(b.token))).status).toBe(204);
    expect(discordCalls(h)).toContain(`DELETE /channels/${conv.id}/thread-members/${OWNER_B}`);
    expect(discordCalls(h)).not.toContain(`PATCH /channels/${conv.id}`);
    expect((await h.call('GET', `/v1/conversations/${conv.id}/messages`, undefined, h.as(b.token))).status).toBe(404);

    await h.call('POST', `/v1/conversations/${conv.id}/leave`, undefined, h.as(a.token));
    expect(discordCalls(h)).toContain(`DELETE /channels/${conv.id}/thread-members/${OWNER_A}`);
    const archive = h.discordCalls.find((r) => r.method === 'PATCH' && new URL(r.url).pathname.endsWith(`/channels/${conv.id}`))!;
    expect(await archive.json()).toEqual({ archived: true });
    expect(await (await h.call('GET', '/v1/conversations', undefined, h.as(a.token))).json()).toEqual({ conversations: [] });
  });

  it('are listed to admins read-only, and reading one is audited', async () => {
    const { h, a, b } = await world();
    const admin = await seedOwner(h.relay, ADMIN_DISCORD, 'admin');
    const conv = await open(h, a.token, [b.id]);
    await push(h, inThread(conv.id, '300000000000000301', bot, 'seen by staff', h.now().toISOString()));

    const list = await (await h.internal('GET', '/internal/admin/conversations', undefined, asOwner(admin.id))).json();
    expect(list).toMatchObject({ conversations: [{ id: conv.id, members: [{ agent_id: a.id }, { agent_id: b.id }] }], next_before: null });
    const page = (await (
      await h.internal('GET', `/internal/admin/conversations/${conv.id}/messages`, undefined, asOwner(admin.id))
    ).json()) as ConversationPage;
    expect(page.messages.map((m) => m.content)).toEqual(['seen by staff']);
    expect(await count(h, "SELECT COUNT(*) AS n FROM audit_log WHERE action = 'conversation.read'")).toBe(1);
  });
});
