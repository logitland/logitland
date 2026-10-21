import { PollInput } from '@logitland/contracts';
import { describe, expect, it, vi } from 'vitest';
import { recordAgentPost } from './services/intake';
import { FORUM_ID, NEW_THREAD, WEBHOOK_POST, calls, converse, json, key, mod, post, row, world } from './posting-fixtures';
import { LOUNGE } from './testing';

vi.mock('./services/intake', async (original) => ({ ...(await original<typeof import('./services/intake')>()), recordAgentPost: vi.fn(async () => {}) }));

const poll = (over: Record<string, unknown> = {}) => ({ question: 'Which color should the bike shed be?', answers: ['Red', 'Green', 'Blue'], ...over });
const sendPoll = (w: Awaited<ReturnType<typeof world>>, body: Record<string, unknown>, idem?: string) => post(w.h, w.a, { channel_id: LOUNGE, ...body }, idem);

describe('sending a poll', () => {
  it('sends a poll alone, in Discord’s shape, with no text', async () => {
    const w = await world();
    const res = await sendPoll(w, { poll: poll() });
    expect(res.status).toBe(201);
    const msg = await json(res);
    expect(msg).toMatchObject({
      status: 'sent',
      content: null,
      poll: { question: 'Which color should the bike shed be?', answers: ['Red', 'Green', 'Blue'], duration_hours: 24, allow_multiselect: false },
    });
    const [sent] = await calls(w.h, 'POST', WEBHOOK_POST);
    expect(sent!.body).not.toHaveProperty('content');
    expect(sent!.body.poll).toEqual({
      question: { text: 'Which color should the bike shed be?' },
      answers: [{ poll_media: { text: 'Red' } }, { poll_media: { text: 'Green' } }, { poll_media: { text: 'Blue' } }],
      duration: 24,
      allow_multiselect: false,
    });
    expect(sent!.body.allowed_mentions).toEqual({ parse: [] });
  });

  it('sends a poll with text, a duration and multiselect', async () => {
    const w = await world();
    const res = await sendPoll(w, { content: 'Please vote, it matters.', poll: poll({ duration_hours: 72, allow_multiselect: true }) });
    expect(res.status).toBe(201);
    const [sent] = await calls(w.h, 'POST', WEBHOOK_POST);
    expect(sent!.body).toMatchObject({ content: 'Please vote, it matters.', poll: { duration: 72, allow_multiselect: true } });
    expect(await row(w.h, (await json(res)).id)).toMatchObject({ content: 'Please vote, it matters.' });
  });

  it('works in a thread and as a new forum post', async () => {
    const w = await world();
    expect((await sendPoll(w, { thread_id: NEW_THREAD, poll: poll() })).status).toBe(201);
    expect((await calls(w.h, 'POST', WEBHOOK_POST))[0]!.url.searchParams.get('thread_id')).toBe(NEW_THREAD);
    const forum = await post(w.h, w.a, { channel_id: FORUM_ID, thread_name: 'Colors', poll: poll({ question: 'Which colors do you like?' }) });
    expect(forum.status).toBe(201);
    expect((await json(forum)).thread_id).toBe(NEW_THREAD);
    expect((await calls(w.h, 'POST', WEBHOOK_POST))[1]!.body).toMatchObject({
      thread_name: 'Colors',
      poll: { question: { text: 'Which colors do you like?' } },
    });
  });

  it('tells intake about the poll in Discord’s shape, the agent’s text apart from it', async () => {
    const w = await world();
    const msg = await json(await sendPoll(w, { content: 'Vote please', poll: poll({ duration_hours: 48, allow_multiselect: true }) }));
    expect(recordAgentPost).toHaveBeenLastCalledWith(
      w.h.relay,
      expect.objectContaining({
        discordMessageId: msg.discord_message_id,
        content: 'Vote please',
        poll: {
          question: { text: 'Which color should the bike shed be?' },
          answers: [
            { answer_id: 1, poll_media: { text: 'Red' } },
            { answer_id: 2, poll_media: { text: 'Green' } },
            { answer_id: 3, poll_media: { text: 'Blue' } },
          ],
          expiry: new Date(Date.parse(w.h.now().toISOString()) + 48 * 3_600_000).toISOString(),
          allow_multiselect: true,
        },
      }),
    );
    await sendPoll(w, { poll: poll({ question: 'A second poll, alone' }) });
    expect(recordAgentPost).toHaveBeenLastCalledWith(w.h.relay, expect.objectContaining({ content: '' }));
  });

  it('shows the poll when the agent reads its message back', async () => {
    const w = await world();
    const msg = await json(await sendPoll(w, { poll: poll() }));
    const fetched = await json(await w.h.call('GET', `/v1/messages/${msg.id}`, undefined, w.h.as(w.a.key)));
    expect(fetched.poll).toMatchObject({ answers: ['Red', 'Green', 'Blue'] });
  });
});

describe('poll limits', () => {
  const refused = async (body: Record<string, unknown>) => {
    const w = await world();
    const res = await sendPoll(w, body);
    expect(res.status).toBe(400);
    expect(w.h.discordCalls).toHaveLength(0);
    return json(res);
  };

  it('needs content, a poll, or both', async () => {
    const problem = await refused({});
    expect(JSON.stringify(problem)).toMatch(/content, a poll, or both/);
    await refused({ content: '   ' });
  });

  it('allows a question of up to 300 characters', async () => {
    const w = await world();
    expect((await sendPoll(w, { poll: poll({ question: 'q'.repeat(299) + '?' }) })).status).toBe(201);
    await refused({ poll: poll({ question: 'q'.repeat(301) }) });
    await refused({ poll: poll({ question: '   ' }) });
  });

  it('allows answers of up to 55 characters', async () => {
    const w = await world();
    expect((await sendPoll(w, { poll: poll({ answers: ['a'.repeat(55), 'b'.repeat(55)] }) })).status).toBe(201);
    await refused({ poll: poll({ answers: ['a'.repeat(56), 'b'] }) });
    await refused({ poll: poll({ answers: ['yes', '  '] }) });
  });

  it('wants 2 to 10 answers', async () => {
    const w = await world();
    expect((await sendPoll(w, { poll: poll({ answers: Array.from({ length: 10 }, (_, i) => `Option ${i + 1}`) }) })).status).toBe(201);
    await refused({ poll: poll({ answers: ['only one'] }) });
    await refused({ poll: poll({ answers: [] }) });
    await refused({ poll: poll({ answers: Array.from({ length: 11 }, (_, i) => `Option ${i + 1}`) }) });
  });

  it('lets a poll stay open from 1 hour to 768 hours (32 days)', async () => {
    const w = await world();
    expect((await sendPoll(w, { poll: poll({ duration_hours: 1 }) })).status).toBe(201);
    expect((await sendPoll(w, { poll: poll({ question: 'A long poll?', duration_hours: 768 }) })).status).toBe(201);
    await refused({ poll: poll({ duration_hours: 0 }) });
    await refused({ poll: poll({ duration_hours: 769 }) });
    await refused({ poll: poll({ duration_hours: 1.5 }) });
  });

  it('is described by the same limits in the contract', () => {
    expect(PollInput.parse({ question: 'q', answers: ['a', 'b'] })).toEqual({
      question: 'q',
      answers: ['a', 'b'],
      duration_hours: 24,
      allow_multiselect: false,
    });
  });
});

describe('poll moderation', () => {
  it('applies the fixed rules to the question and the answers', async () => {
    const w = await world();
    const invite = await json(await sendPoll(w, { poll: poll({ question: 'Join discord.gg/abc123 for more?' }) }));
    expect(invite).toMatchObject({ status: 'blocked', policy_code: 'invite_link' });
    expect(invite.status_reason).toMatch(/The poll/);
    const held = await json(await sendPoll(w, { poll: poll({ answers: ['Call 555-123-4567', 'No'] }) }));
    expect(held).toMatchObject({ status: 'held', policy_code: 'personal_info' });
    const domain = await json(await sendPoll(w, { poll: poll({ answers: ['See bit.ly/abc', 'No'] }) }));
    expect(domain).toMatchObject({ status: 'blocked', policy_code: 'blocked_domain' });
    expect(w.h.discordCalls).toHaveLength(0);
  });

  it('holds a probation agent’s poll with a link', async () => {
    const w = await world();
    const { seedAgent } = await import('./testing');
    const fresh = await seedAgent(w.h.relay, { tier: 'new', probationUntil: new Date(w.h.now().getTime() + 3_600_000).toISOString() });
    const msg = await json(await post(w.h, fresh, { channel_id: LOUNGE, poll: poll({ question: 'Is https://example.com any good?' }) }));
    expect(msg).toMatchObject({ status: 'held', policy_code: 'links_not_allowed' });
  });

  it('keeps no text of a credential hiding in a poll', async () => {
    const w = await world();
    const secret = `lk_${'K7QMXV2D'.repeat(6)}`;
    const msg = await json(await sendPoll(w, { poll: poll({ answers: [secret, 'No'] }) }));
    expect(msg).toMatchObject({ status: 'blocked', policy_code: 'secret_leak', content: null, poll: null });
    expect(JSON.stringify(await w.h.db.prepare('SELECT * FROM relay_messages').all())).not.toContain(secret);
    expect(JSON.stringify(await w.h.db.prepare('SELECT * FROM moderation_log').all())).not.toContain(secret);
  });

  it('shows the classifier the text and then the question and answers', async () => {
    const moderator = mod();
    const w = await world({ moderator });
    await sendPoll(w, { content: 'Vote please', poll: poll() });
    await sendPoll(w, { poll: poll({ question: 'Another question entirely?' }) });
    expect(moderator.calls[0]!.content).toBe('Vote please\n\nPoll: Which color should the bike shed be?\n- Red\n- Green\n- Blue');
    expect(moderator.calls[1]!.content).toBe('Poll: Another question entirely?\n- Red\n- Green\n- Blue');
  });

  it('blocks and holds on the classifier’s say-so', async () => {
    const moderator = mod((req) =>
      req.content.includes('Poll: Hateful')
        ? { verdict: 'block', policy_code: 'hate' }
        : req.content.includes('Poll: Borderline')
          ? { verdict: 'hold', policy_code: 'sexual' }
          : { verdict: 'pass' },
    );
    const w = await world({ moderator });
    expect(await json(await sendPoll(w, { poll: poll({ question: 'Hateful question?' }) }))).toMatchObject({ status: 'blocked', policy_code: 'hate' });
    expect(await json(await sendPoll(w, { poll: poll({ question: 'Borderline question?' }) }))).toMatchObject({ status: 'held', policy_code: 'sexual' });
    expect(w.h.discordCalls).toHaveLength(0);
  });

  it('shows the reviewer the poll and the message it replies to', async () => {
    const w = await world();
    const target = await converse(w.h, { author: 'agent', name: 'Orrery' });
    const held = await json(await sendPoll(w, { reply_to: target, poll: poll({ answers: ['Call 555-123-4567', 'No'] }) }));
    const { seedOwner, ADMIN_DISCORD } = await import('./testing');
    const admin = await seedOwner(w.h.relay, ADMIN_DISCORD, 'admin');
    const queue = await json(await w.h.internal('GET', '/internal/admin/moderation/queue', undefined, { 'x-logitland-owner': admin.id }));
    expect(queue.items.find((i: any) => i.id === held.id)).toMatchObject({
      content: null,
      reply_to: target,
      poll: { question: 'Which color should the bike shed be?', answers: ['Call 555-123-4567', 'No'], duration_hours: 24, allow_multiselect: false },
    });
  });

  it('is released from the review queue with its poll intact', async () => {
    const w = await world();
    const held = await json(await sendPoll(w, { poll: poll({ answers: ['Call 555-123-4567', 'No'], duration_hours: 12 }) }));
    expect(held.status).toBe('held');
    const { seedOwner, ADMIN_DISCORD } = await import('./testing');
    const admin = await seedOwner(w.h.relay, ADMIN_DISCORD, 'admin');
    const res = await w.h.internal('POST', `/internal/admin/messages/${held.id}/release`, {}, { 'x-logitland-owner': admin.id });
    expect((await json(res)).status).toBe('sent');
    expect((await calls(w.h, 'POST', WEBHOOK_POST))[0]!.body.poll).toMatchObject({
      duration: 12,
      answers: [{ poll_media: { text: 'Call 555-123-4567' } }, { poll_media: { text: 'No' } }],
    });
  });
});

describe('repeated polls', () => {
  it('blocks the same poll from the same agent in the same channel inside ten minutes', async () => {
    const w = await world();
    expect((await sendPoll(w, { poll: poll() })).status).toBe(201);
    const again = await json(await sendPoll(w, { poll: poll() }));
    expect(again).toMatchObject({ status: 'blocked', policy_code: 'duplicate' });
    expect(again.status_reason).toMatch(/same poll/);
    w.h.advance(11 * 60_000);
    expect((await json(await sendPoll(w, { poll: poll() }))).status).toBe('sent');
  });

  it('does not take two different polls for repeats because neither has text', async () => {
    const w = await world();
    expect((await json(await sendPoll(w, { poll: poll({ question: 'First question?' }) }))).status).toBe('sent');
    expect((await json(await sendPoll(w, { poll: poll({ question: 'Second question?' }) }))).status).toBe('sent');
  });

  it('does not hold polls that other agents also sent', async () => {
    const w = await world();
    const { seedAgent } = await import('./testing');
    const b = await seedAgent(w.h.relay, { tier: 'claimed' });
    const c = await seedAgent(w.h.relay, { tier: 'claimed' });
    for (const agent of [w.a, b, c]) expect((await json(await post(w.h, agent, { channel_id: LOUNGE, poll: poll() }))).status).toBe('sent');
  });

  it('treats the same key with a different poll as a different request', async () => {
    const w = await world();
    const k = key();
    expect((await sendPoll(w, { poll: poll() }, k)).status).toBe(201);
    expect((await sendPoll(w, { poll: poll() }, k)).status).toBe(201);
    expect((await sendPoll(w, { poll: poll({ allow_multiselect: true }) }, k)).status).toBe(409);
    expect((await sendPoll(w, { poll: poll({ duration_hours: 25 }) }, k)).status).toBe(409);
    expect(await calls(w.h, 'POST', WEBHOOK_POST)).toHaveLength(1);
  });
});

describe('when Discord cannot take the poll', () => {
  it('fails the message with a fixed reason', async () => {
    const w = await world();
    w.h.setDiscord(() => Response.json({ message: 'Invalid poll', code: 50035 }, { status: 400 }));
    const k = key();
    const msg = await json(await sendPoll(w, { poll: poll() }, k));
    expect(msg).toMatchObject({ status: 'failed', status_reason: 'Discord refused the message. If this keeps happening, tell an admin.' });
    expect(JSON.stringify(msg)).not.toContain('Invalid poll');
  });

  it('can reply to a message with a poll', async () => {
    const w = await world();
    const target = await converse(w.h, { author: 'agent', name: 'Orrery' });
    expect((await sendPoll(w, { reply_to: target, content: 'Let us vote on that', poll: poll() })).status).toBe(201);
    const [sent] = await calls(w.h, 'POST', WEBHOOK_POST);
    expect(sent!.body.content).toMatch(/^-# ↪ Replying to \*\*Orrery\*\* · .*\nLet us vote on that$/);
    expect(sent!.body.poll.question.text).toBe('Which color should the bike shed be?');
  });
});
