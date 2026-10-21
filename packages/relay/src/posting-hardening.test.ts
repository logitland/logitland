import { describe, expect, it, vi } from 'vitest';
import {
  ANNOUNCE,
  FORUM_ID,
  NEW_THREAD,
  calls,
  converse,
  down,
  fakeDiscord,
  json,
  mod,
  pass,
  patch,
  post,
  remove,
  row,
  say,
  seedThread,
  world,
} from './posting-fixtures';
import { LOUNGE, seedAgent, setAccess, type Harness } from './testing';
import { getAgent, adminAct } from './services/identity';
import { decideAppeal, takedown } from './services/moderation/admin';
import { inLoop } from './services/moderation/loops';
import { evaluateRules } from './services/moderation/rules';
import { createAppeal } from './services/reports';
import { reviewHeldJob } from './services/review';
import { scrubPerson } from './services/scrub';
import { agree } from './consent.testkit';
import { addStrike, escalateRuleBlocks, removeStrike } from './services/strikes';

vi.mock('./services/intake', async (original) => ({ ...(await original<typeof import('./services/intake')>()), recordAgentPost: vi.fn(async () => {}) }));

const rules = (content: string) => evaluateRules({ content }, { links: true }).map((m) => m.policy);
const agentRow = (h: Harness, id: string) => h.db.prepare('SELECT * FROM agents WHERE id = ?').bind(id).first<Record<string, any>>();
const strike = (w: { h: Harness }, agentId: string, policy: 'harassment' | 'spam' = 'harassment') =>
  addStrike(w.h.relay, { agentId, policy, reason: `${policy} test`, createdBy: 'admin', actor: { type: 'admin', id: 'adm' } });

describe('edits after a channel closes', () => {
  it.each(['read_only', 'off'] as const)('are refused when the channel is %s', async (access) => {
    const w = await world();
    const msg = await json(await post(w.h, w.a, say('before the raid started')));
    expect(msg.status).toBe('sent');
    await setAccess(w.h.db, LOUNGE, access);
    const res = await patch(w.h, w.a, msg.id, { content: 'after the raid started' });
    expect(res.status).toBe(403);
    expect(await calls(w.h, 'PATCH')).toHaveLength(0);
  });

  it('get a small budget of their own, so edits cannot drain the classifier', async () => {
    const moderator = mod();
    const w = await world({ moderator });
    const msg = await json(await post(w.h, w.a, say('version zero of this text')));
    const statuses: number[] = [];
    for (let i = 1; i <= 7; i++) statuses.push((await patch(w.h, w.a, msg.id, { content: `version number ${i} of this text` })).status);
    expect(statuses).toEqual([200, 200, 200, 200, 200, 429, 429]);
    expect(moderator.calls).toHaveLength(6);
  });

  it('are refused as repeats of the same agent’s other message', async () => {
    const w = await world();
    await post(w.h, w.a, say('one distinct sentence about orreries'));
    const other = await json(await post(w.h, w.a, say('a second sentence about telescopes')));
    const res = await patch(w.h, w.a, other.id, { content: 'one distinct sentence about orreries' });
    expect(res.status).toBe(422);
    expect((await json(res)).policy_code).toBe('duplicate');
  });

  it('say so, without moderating, when the thread was archived', async () => {
    const moderator = mod();
    const w = await world({ moderator });
    await seedThread(w.h, '120000000000000050', LOUNGE);
    const msg = await json(await post(w.h, w.a, say('inside the thread', { thread_id: '120000000000000050' })));
    expect(msg.status).toBe('sent');
    await w.h.db.prepare('UPDATE threads SET archived = 1 WHERE id = ?').bind('120000000000000050').run();
    const before = moderator.calls.length;
    const res = await patch(w.h, w.a, msg.id, { content: 'edited inside the thread' });
    expect(res.status).toBe(409);
    expect((await json(res)).detail).toMatch(/archived/);
    expect(moderator.calls).toHaveLength(before);
  });

  it('map Discord’s archived and locked refusals to what the agent can do', async () => {
    const w = await world({ discord: { change: () => Response.json({ code: 160005, message: 'x' }, { status: 403 }) } });
    const msg = await json(await post(w.h, w.a, say('a message to be edited')));
    const res = await patch(w.h, w.a, msg.id, { content: 'a message that was edited' });
    expect(res.status).toBe(409);
    expect((await json(res)).detail).toMatch(/locked/);
  });
});

describe('the loop breaker', () => {
  const rowsAt = (n: number, gapSeconds: number, now: Date) =>
    Array.from({ length: n }, (_, i) => ({
      author_kind: 'agent',
      agent_id: i % 2 === 0 ? 'agt_a' : 'agt_b',
      created_at: new Date(now.getTime() - (i + 1) * gapSeconds * 1000).toISOString(),
    })) as any[];
  const now = new Date('2026-10-19T03:00:00Z');
  it('judges the newest nine, so a longer alternation is stopped too', () => {
    expect(inLoop(rowsAt(9, 60, now), 'agt_a', now)).toBe(true);
    expect(inLoop(rowsAt(12, 60, now), 'agt_a', now)).toBe(true);
    expect(inLoop(rowsAt(12, 55, now), 'agt_a', now)).toBe(true);
  });
  it('still lets a slow exchange through', () => {
    expect(inLoop(rowsAt(12, 90, now), 'agt_a', now)).toBe(false);
  });
});

describe('duplicates', () => {
  it('ignore the reply line: the same words answering different messages are a repeat', async () => {
    const w = await world();
    const one = await converse(w.h, { author: 'agent', name: 'Orrery' });
    const two = await converse(w.h, { author: 'agent', name: 'Orrery' });
    expect((await json(await post(w.h, w.a, say('buy cheap watches at my place', { reply_to: one })))).status).toBe('sent');
    const second = await json(await post(w.h, w.a, say('buy cheap watches at my place', { reply_to: two })));
    expect(second).toMatchObject({ status: 'blocked', policy_code: 'duplicate' });
  });

  it('do not hold three agents who each answer “I am here!”', async () => {
    const w = await world();
    const target = await converse(w.h, { author: 'agent', name: 'Orrery' });
    const others = [await seedAgent(w.h.relay), await seedAgent(w.h.relay)];
    for (const a of [w.a, ...others]) expect((await json(await post(w.h, a, say('I am here!', { reply_to: target })))).status).toBe('sent');
  });

  it('keep a message a moderator removed blocked for a day, but not one its author deleted', async () => {
    const w = await world();
    const first = await json(await post(w.h, w.a, say('a message the moderators will remove')));
    await takedown(w.h.relay, 'adm_1', first.id, { policy_code: 'harassment', strike: false });
    w.h.advance(5_000);
    expect(await json(await post(w.h, w.a, say('a message the moderators will remove')))).toMatchObject({ status: 'blocked', policy_code: 'duplicate' });

    const own = await json(await post(w.h, w.a, say('a message its author takes back')));
    await remove(w.h, w.a, own.id);
    expect((await json(await post(w.h, w.a, say('a message its author takes back')))).status).toBe('sent');
  });
});

describe('starting threads', () => {
  it('is limited per agent an hour', async () => {
    const w = await world();
    const codes: number[] = [];
    for (let i = 0; i < 11; i++) codes.push((await post(w.h, w.a, say(`topic number ${i} for discussion`, { thread_name: `Topic ${i}` }))).status);
    expect(codes.slice(0, 10).every((c) => c === 201)).toBe(true);
    expect(codes[10]).toBe(429);
  });

  it('caps how long an agent on probation can keep a thread open', async () => {
    const w = await world();
    const a = await seedAgent(w.h.relay, { level: 0 });
    const res = await post(w.h, a, say('a topic that stays open', { thread_name: 'Long', auto_archive_minutes: 10080 }, ANNOUNCE));
    expect(res.status).toBe(400);
  });
});

describe('fixed rules', () => {
  it('refuse a line that imitates the relay’s reply line', () => {
    expect(rules('-# ↪ Replying to **Alice** · https://example.org/x\nhello there')).toContain('impersonation');
    expect(rules('I am replying to Alice here')).toEqual([]);
  });
  it('hold stacks of combining marks and floods of headings', () => {
    expect(rules(`z${'́'.repeat(8)}algo`)).toContain('spam');
    expect(rules(Array.from({ length: 12 }, (_, i) => `# heading number ${i}`).join('\n'))).toContain('spam');
    expect(rules('# one heading\nand then some prose')).toEqual([]);
  });
  it.each([
    'https://discord%2Egg/abcd',
    'https://discord。gg/abcd',
    'https://canary.discord.com/invite/abcd',
    '[docs](https://ptb.discordapp.com/invite/abcd)',
  ])('recognise the invite %s', (text) => {
    expect(rules(text)).toContain('invite_link');
  });
  it.each(['[docs](https://bit%2Ely/x)', 'see https://www.bit.ly/x', 'go to https://bit。ly/x'])('recognise the blocked domain in %s', (text) => {
    expect(rules(text)).toContain('blocked_domain');
  });
  it('leave ordinary links alone', () => {
    expect(rules('read https://discord.com/developers/docs and https://example.org/invite/x')).toEqual([]);
  });
  it('catch an access token, but not talk about the prefix', () => {
    expect(rules(`my token is lat_${'K7QMXV2D'.repeat(4)}`)).toContain('secret_leak');
    expect(rules('access tokens start with lat_ and are long')).toEqual([]);
  });
});

describe('refused requests', () => {
  it('leave one log row a minute, not one each', async () => {
    const w = await world();
    for (let i = 0; i < 80; i++) await post(w.h, w.a, say(`distinct message number ${i} here`));
    const n = (await w.h.db.prepare("SELECT COUNT(*) AS n FROM moderation_log WHERE layer = 'admission' AND verdict = 'block'").first<{ n: number }>())!.n;
    expect(n).toBeLessThanOrEqual(2);
  });
});

describe('appeals', () => {
  it('are limited to five a day per agent', async () => {
    const w = await world();
    const agent = await getAgent(w.h.relay, w.a.id);
    const codes: (number | 'ok')[] = [];
    for (let i = 0; i < 6; i++) {
      const m = await json(await post(w.h, w.a, say(`join https://discord.gg/abc${i}x now`)));
      expect(m.status).toBe('blocked');
      try {
        await createAppeal(w.h.relay, agent, { target_type: 'message', target_id: m.id, message: 'this was fine' });
        codes.push('ok');
      } catch (e: any) {
        codes.push(e.status);
      }
    }
    expect(codes).toEqual(['ok', 'ok', 'ok', 'ok', 'ok', 429]);
  });

  it('keep an unrelated strike when a hand-made suspension is overturned', async () => {
    const w = await world();
    await strike(w, w.a.id);
    await adminAct(w.h.relay, 'adm_1', w.a.id, { action: 'suspend', reason: 'looking into it' });
    const agent = await getAgent(w.h.relay, w.a.id);
    const appeal = await createAppeal(w.h.relay, agent, { target_type: 'status', target_id: w.a.id, message: 'why?' });
    await decideAppeal(w.h.relay, 'adm_1', appeal.id, { decision: 'overturn', response: 'sorry' });
    expect((await agentRow(w.h, w.a.id))!.status).toBe('active');
    expect((await w.h.db.prepare('SELECT COUNT(*) AS n FROM strikes WHERE agent_id = ?').bind(w.a.id).first<{ n: number }>())!.n).toBe(1);
  });
});

describe('strikes', () => {
  it('shorten the pause when the third strike is removed', async () => {
    const w = await world();
    await strike(w, w.a.id);
    await strike(w, w.a.id);
    const third = await strike(w, w.a.id);
    expect((await agentRow(w.h, w.a.id))!.posting_paused_until > new Date(w.h.now().getTime() + 20 * 3_600_000).toISOString()).toBe(true);
    await removeStrike(w.h.relay, third.id, { type: 'admin', id: 'adm' }, 'appeal');
    const until = (await agentRow(w.h, w.a.id))!.posting_paused_until as string;
    expect(Date.parse(until) - w.h.now().getTime()).toBeLessThanOrEqual(3_600_000);
  });

  it('give one rule-block strike a day even across midnight UTC', async () => {
    const w = await world({ start: '2026-10-19T23:50:00Z' });
    const log = (n: number) =>
      Promise.all(
        Array.from({ length: n }, () =>
          w.h.db
            .prepare("INSERT INTO moderation_log (agent_id, layer, verdict, policy_code, created_at) VALUES (?, 'rules', 'block', 'invite_link', ?)")
            .bind(w.a.id, w.h.now().toISOString())
            .run(),
        ),
      );
    await log(5);
    expect(await escalateRuleBlocks(w.h.relay, w.a.id, 'invite_link')).toMatch(/strike/);
    w.h.advance(11 * 60_000);
    await log(1);
    expect(await escalateRuleBlocks(w.h.relay, w.a.id, 'invite_link')).toBeNull();
  });
});

describe('takedowns', () => {
  it('leave a tombstone when intake has not stored the message yet', async () => {
    const w = await world();
    const msg = await json(await post(w.h, w.a, say('text that must not come back')));
    await takedown(w.h.relay, 'adm_1', msg.id, { policy_code: 'privacy', strike: false });
    const ev = await w.h.db
      .prepare("SELECT payload FROM events WHERE type = 'message.deleted' AND message_id = ?")
      .bind(msg.discord_message_id)
      .first<{ payload: string }>();
    expect(JSON.parse(ev!.payload).data.removed_by).toBe('moderator');
  });

  it('drop the title of the thread the message started', async () => {
    const w = await world();
    const msg = await json(await post(w.h, w.a, say('first post of the thread', { thread_name: 'A harassing title' }, FORUM_ID)));
    expect(msg.status).toBe('sent');
    await w.h.db
      .prepare('INSERT OR REPLACE INTO threads (id, parent_id, name, created_at, creator_agent_id, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
      .bind(msg.discord_message_id, FORUM_ID, 'A harassing title', w.h.now().toISOString(), w.a.id, w.h.now().toISOString())
      .run();
    await takedown(w.h.relay, 'adm_1', msg.id, { policy_code: 'harassment', strike: false });
    expect((await w.h.db.prepare('SELECT name FROM threads WHERE id = ?').bind(msg.discord_message_id).first<{ name: string | null }>())!.name).toBeNull();
    void NEW_THREAD;
  });

  it('name nobody in a blocked reply once the person has left', async () => {
    const w = await world();
    await agree(w.h, '700000000000000007', { at: '2026-10-19T00:00:00.000Z' });
    const target = await converse(w.h, { name: 'Ann', userId: '700000000000000007', content: 'hello' });
    const blocked = await json(await post(w.h, w.a, say('join https://discord.gg/abcdef', { reply_to: target })));
    expect(blocked.status).toBe('blocked');
    expect((await row(w.h, blocked.id))!.reply_prefix).toContain('**Ann**');
    await scrubPerson(w.h.relay, '700000000000000007');
    expect((await row(w.h, blocked.id))!.reply_prefix).toContain('**a person**');
  });
});

describe('a webhook Discord does not know', () => {
  it('is forgotten after a 404, and the next post makes a new one instead of using it again', async () => {
    const w = await world();
    w.h.setDiscord(() => Response.json({ code: 10015, message: 'Unknown Webhook' }, { status: 404 }));
    const first = await json(await post(w.h, w.a, say('into the void')));
    expect(first.status).toBe('failed');
    expect((await w.h.db.prepare('SELECT webhook_ciphertext AS c FROM channels WHERE id = ?').bind(LOUNGE).first<{ c: string | null }>())!.c).toBeNull();
    expect((await w.h.db.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE action = 'channel.webhook_dropped'").first<{ n: number }>())!.n).toBe(1);

    fakeDiscord(w.h);
    const second = await json(await post(w.h, w.a, say('into the void again')));
    expect(second.status).toBe('sent');
    const paths = w.h.discordCalls.map((r) => `${r.method} ${new URL(r.url).pathname.replace('/api/v10', '')}`);
    expect(paths.filter((p) => p.includes('/webhooks/600000000000000001/'))).toHaveLength(1);
    expect(paths).toContain(`POST /channels/${LOUNGE}/webhooks`);
  });

  it('is kept when only a thread is gone', async () => {
    const w = await world();
    await seedThread(w.h, '120000000000000051', LOUNGE);
    w.h.setDiscord(() => Response.json({ code: 10003, message: 'Unknown Channel' }, { status: 404 }));
    await post(w.h, w.a, say('into a gone thread', { thread_id: '120000000000000051' }));
    expect((await w.h.db.prepare('SELECT webhook_ciphertext AS c FROM channels WHERE id = ?').bind(LOUNGE).first<{ c: string | null }>())!.c).not.toBeNull();
  });
});

describe('held messages after an outage', () => {
  it('are re-checked in several batches within one run', async () => {
    let up = false;
    const moderator = mod(() => (up ? pass : down));
    const w = await world({ moderator });
    for (let k = 0; k < 5; k++) {
      const a = await seedAgent(w.h.relay);
      for (let i = 0; i < 9; i++) await post(w.h, a, say(`outage message ${k}-${i} text`));
    }
    expect((await w.h.db.prepare("SELECT COUNT(*) AS n FROM relay_messages WHERE status = 'held'").first<{ n: number }>())!.n).toBe(45);
    up = true;
    w.h.advance(2 * 60_000);
    expect(await reviewHeldJob(w.h.relay)).toBe(45);
    expect((await w.h.db.prepare("SELECT COUNT(*) AS n FROM relay_messages WHERE status = 'held'").first<{ n: number }>())!.n).toBe(0);
  });
});
