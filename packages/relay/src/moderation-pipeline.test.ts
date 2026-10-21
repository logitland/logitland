import { describe, expect, it, vi } from 'vitest';
import type { ModerationRequest, ModerationResult, Moderator } from './services/moderation/classifier';
import { sendMessage } from './services/messages';
import { authenticateKey } from './services/identity';
import { NO_CLIENT } from './types';
import { agree } from './consent.testkit';
import { BENCH, LOUNGE, harness, seedAgent, seedChannel, type Harness, type HarnessOptions } from './testing';

vi.mock('./services/intake', async (original) => ({ ...(await original<typeof import('./services/intake')>()), recordAgentPost: vi.fn(async () => {}) }));

const pass: ModerationResult = { verdict: 'pass' };
const down: ModerationResult = { verdict: null, unavailable: true, reason: 'it is down' };
const mod = (answer: ModerationResult | ((req: ModerationRequest) => ModerationResult | Promise<ModerationResult>) = pass) => {
  const calls: ModerationRequest[] = [];
  const moderator: Moderator & { calls: ModerationRequest[] } = {
    calls,
    review: async (req) => {
      calls.push(req);
      return typeof answer === 'function' ? answer(req) : answer;
    },
  };
  return moderator;
};

async function setup(opts: HarnessOptions = {}, agent: Parameters<typeof seedAgent>[1] = {}, channel: Parameters<typeof seedChannel>[1] = {}) {
  const h = harness({ moderator: mod(), ...opts });
  await seedChannel(h.relay, { id: LOUNGE, access: 'post', pace: 120, ...channel });
  const a = await seedAgent(h.relay, { tier: 'claimed', ...agent });
  return { h, a };
}

let counter = 0;
const post = (h: Harness, a: { key: string }, text: string, extra: Record<string, unknown> = {}, channel_id = LOUNGE) =>
  h.call('POST', '/v1/messages', { channel_id, content: text, ...extra }, { ...h.as(a.key), 'idempotency-key': `key-${++counter}-padding` });
const json = async (res: Response) => (await res.json()) as Record<string, any>;
const status = async (res: Response) => (await json(res)).status as string;
const logOf = (h: Harness, id: string) =>
  h.db
    .prepare('SELECT layer, verdict, policy_code, reason, source FROM moderation_log WHERE message_id = ? ORDER BY id')
    .bind(id)
    .all<{ layer: string; verdict: string; policy_code: string | null; reason: string | null; source: string | null }>()
    .then((r) => r.results);
/** For seeds made before the harness exists; the harness clock starts here. */
const inHours = (hours: number) => new Date(Date.parse('2026-10-19T03:00:00Z') + hours * 3_600_000).toISOString();
const future = (h: Harness, hours = 24) => new Date(h.now().getTime() + hours * 3_600_000).toISOString();
const past = (h: Harness) => new Date(h.now().getTime() - 3_600_000).toISOString();

describe('fixed rules, end to end', () => {
  it('block with a policy code and a sentence, never reaching the classifier or Discord', async () => {
    const moderator = mod();
    const { h, a } = await setup({ moderator });
    const res = await post(h, a, 'join us at discord.gg/abc123');
    expect(res.status).toBe(200);
    const msg = await json(res);
    expect(msg).toMatchObject({ status: 'blocked', verdict: 'block', policy_code: 'invite_link', discord_message_id: null });
    expect(msg.status_reason).toMatch(/invite/);
    expect(moderator.calls).toHaveLength(0);
    expect(h.discordCalls).toHaveLength(0);
    const log = await logOf(h, msg.id);
    expect(log.find((l) => l.layer === 'rules')).toMatchObject({ verdict: 'block', policy_code: 'invite_link', source: 'rules' });
    expect(log.some((l) => l.layer === 'classifier')).toBe(false);
  });

  it('hold personal information for review', async () => {
    const { h, a } = await setup();
    const res = await post(h, a, 'reach me at someone@example.com');
    expect(res.status).toBe(202);
    expect(await json(res)).toMatchObject({ status: 'held', verdict: 'hold', policy_code: 'personal_info' });
    expect((await h.db.prepare('SELECT held_kind FROM relay_messages').first<{ held_kind: string }>())!.held_kind).toBe('review');
    expect(h.discordCalls).toHaveLength(0);
  });

  it('keep none of a leaked credential, say to rotate it, and add no strike', async () => {
    const { h, a } = await setup();
    const secret = 'lk_' + 'K7QMXV2D'.repeat(6);
    const res = await post(h, a, `my key is ${secret}`, {}, LOUNGE);
    const msg = await json(res);
    expect(msg).toMatchObject({ status: 'blocked', policy_code: 'secret_leak', content: null });
    expect(msg.status_reason).toMatch(/rotate a relay key now with POST \/v1\/me\/keys\/rotate/);
    expect(msg.status_reason).toMatch(/It was not posted/);
    const stored = await h.db.prepare('SELECT * FROM relay_messages').first<Record<string, unknown>>();
    expect(JSON.stringify(stored)).not.toContain(secret);
    expect(JSON.stringify(await h.db.prepare('SELECT * FROM moderation_log').all())).not.toContain(secret);
    expect((await h.db.prepare('SELECT COUNT(*) AS n FROM strikes').first<{ n: number }>())!.n).toBe(0);
  });

  it('write a log row for every layer a clean message passes', async () => {
    const { h, a } = await setup();
    const msg = await json(await post(h, a, 'a perfectly ordinary message'));
    expect(msg.status).toBe('sent');
    const log = await logOf(h, msg.id);
    expect(log.map((l) => `${l.layer}:${l.verdict}`)).toEqual(['rules:pass', 'limits:pass', 'admission:pass', 'classifier:pass']);
    expect(log.find((l) => l.layer === 'classifier')!.source).toBe('primary');
    const latency = await h.db.prepare("SELECT latency_ms FROM moderation_log WHERE layer = 'classifier'").first<{ latency_ms: number | null }>();
    expect(latency!.latency_ms).toBeGreaterThanOrEqual(0);
  });
});

describe('probation', () => {
  it('holds a link from an agent on probation, claimed or not, and lets a trusted agent post the same one', async () => {
    const { h, a } = await setup({}, { tier: 'new', probationUntil: inHours(24) });
    const claimed = await seedAgent(h.relay, { tier: 'claimed', probationUntil: future(h) });
    const trusted = await seedAgent(h.relay, { tier: 'trusted', probationUntil: future(h) });
    const held = await json(await post(h, a, 'docs: https://example.com/guide'));
    expect(held).toMatchObject({ status: 'held', policy_code: 'links_not_allowed' });
    expect(held.status_reason).toMatch(/probation/);
    expect(held.status_reason).toMatch(/held for a reviewer/);
    expect(held.status_reason).not.toMatch(/try again|rephrase/i);
    expect(await status(await post(h, claimed, 'docs: https://example.com/guide'))).toBe('held');
    expect(await status(await post(h, trusted, 'docs, for trusted: https://example.com/guide'))).toBe('sent');
  });

  it('applies to a claimed agent until both the time and the post count are done', async () => {
    const { h } = await setup();
    const link = (who: string) => `${who} says see https://example.com/page`;
    const timeLeft = await seedAgent(h.relay, { tier: 'claimed', probationUntil: future(h) });
    await h.db.prepare('UPDATE agents SET probation_posts = 20 WHERE id = ?').bind(timeLeft.id).run();
    const postsLeft = await seedAgent(h.relay, { tier: 'claimed', probationUntil: past(h) });
    await h.db.prepare('UPDATE agents SET probation_posts = 5 WHERE id = ?').bind(postsLeft.id).run();
    const done = await seedAgent(h.relay, { tier: 'claimed', probationUntil: past(h) });
    await h.db.prepare('UPDATE agents SET probation_posts = 20 WHERE id = ?').bind(done.id).run();
    expect(await status(await post(h, timeLeft, link('time')))).toBe('held');
    expect(await status(await post(h, postsLeft, link('posts')))).toBe('held');
    expect(await status(await post(h, done, link('done')))).toBe('sent');
  });

  it('lasts while either the time or the post count is unfinished', async () => {
    const { h } = await setup();
    const link = (who: string) => `${who} says see https://example.com/page`;
    const timeLeft = await seedAgent(h.relay, { tier: 'new', probationUntil: future(h) });
    await h.db.prepare('UPDATE agents SET probation_posts = 20 WHERE id = ?').bind(timeLeft.id).run();
    const postsLeft = await seedAgent(h.relay, { tier: 'new', probationUntil: past(h) });
    await h.db.prepare('UPDATE agents SET probation_posts = 5 WHERE id = ?').bind(postsLeft.id).run();
    const done = await seedAgent(h.relay, { tier: 'new', probationUntil: past(h) });
    await h.db.prepare('UPDATE agents SET probation_posts = 20 WHERE id = ?').bind(done.id).run();
    expect(await status(await post(h, timeLeft, link('time')))).toBe('held');
    expect(await status(await post(h, postsLeft, link('posts')))).toBe('held');
    expect(await status(await post(h, done, link('done')))).toBe('sent');
  });

  it('ends once enough posts have been sent', async () => {
    const { h } = await setup();
    const a = await seedAgent(h.relay, { tier: 'new', probationUntil: past(h) });
    await h.db.prepare('UPDATE agents SET probation_posts = 19 WHERE id = ?').bind(a.id).run();
    expect(await status(await post(h, a, 'link while new https://example.com/a'))).toBe('held');
    expect(await status(await post(h, a, 'one more plain post'))).toBe('sent');
    expect(await status(await post(h, a, 'link after probation https://example.com/b'))).toBe('sent');
  });

  it('turns a classifier flag into a hold for new agents only', async () => {
    const moderator = mod({ verdict: 'pass', policy_code: 'privacy' });
    const { h, a } = await setup({ moderator }, { tier: 'new', probationUntil: inHours(24) });
    const established = await seedAgent(h.relay, { tier: 'trusted' });
    const held = await json(await post(h, a, 'a message the classifier flags but passes'));
    expect(held).toMatchObject({ status: 'held', verdict: 'hold', policy_code: 'privacy' });
    expect(held.status_reason).toMatch(/While your agent is on probation, flagged messages are held for a reviewer/);
    expect(await status(await post(h, established, 'another message the classifier flags but passes'))).toBe('sent');
    const logged = await h.db.prepare("SELECT verdict, policy_code FROM moderation_log WHERE layer = 'classifier' ORDER BY id DESC LIMIT 1").first();
    expect(logged).toMatchObject({ verdict: 'pass', policy_code: 'privacy' });
  });

  it('passes the tier to the classifier', async () => {
    const moderator = mod();
    const { h, a } = await setup({ moderator }, { tier: 'new', probationUntil: inHours(24) });
    await post(h, a, 'plain words');
    expect(moderator.calls[0]).toMatchObject({ tier: 'new', kind: 'message', agent_id: a.id, channel_id: LOUNGE, strikes: 0 });
  });
});

describe('duplicates', () => {
  const same = 'The quick brown fox jumps over the lazy dog.';

  it('hold the third different agent to send the same text inside ten minutes', async () => {
    const { h, a } = await setup();
    const b = await seedAgent(h.relay, { tier: 'claimed' });
    const c = await seedAgent(h.relay, { tier: 'claimed' });
    expect(await status(await post(h, a, same))).toBe('sent');
    h.advance(60_000);
    expect(await status(await post(h, b, same.toUpperCase()))).toBe('sent');
    h.advance(60_000);
    const third = await json(await post(h, c, `  ${same.toLowerCase()}\n`));
    expect(third).toMatchObject({ status: 'held', verdict: 'hold', policy_code: 'duplicate' });
    expect(third.status_reason).toMatch(/Several agents/);
    const log = await logOf(h, third.id);
    expect(log.find((l) => l.layer === 'limits')).toMatchObject({ verdict: 'hold', policy_code: 'duplicate' });
  });

  it('forget the others after ten minutes', async () => {
    const { h, a } = await setup();
    const b = await seedAgent(h.relay, { tier: 'claimed' });
    const c = await seedAgent(h.relay, { tier: 'claimed' });
    await post(h, a, same);
    await post(h, b, same);
    h.advance(11 * 60_000);
    expect(await status(await post(h, c, same))).toBe('sent');
  });

  it('count each agent once, however often it repeated itself', async () => {
    const { h, a } = await setup({}, {}, { pace: 120 });
    const b = await seedAgent(h.relay, { tier: 'claimed' });
    const c = await seedAgent(h.relay, { tier: 'claimed' });
    await post(h, a, same);
    await post(h, a, same); // blocked as a repeat, but still only agent a
    await post(h, b, same);
    expect(await status(await post(h, c, same))).toBe('held');
  });

  it('block the same agent repeating itself in a channel, until ten minutes pass', async () => {
    const { h, a } = await setup();
    await post(h, a, same);
    const again = await json(await post(h, a, same));
    expect(again).toMatchObject({ status: 'blocked', verdict: 'block', policy_code: 'duplicate' });
    expect(again.status_reason).toMatch(/10 minutes/);
    expect(h.discordCalls).toHaveLength(1);
    h.advance(11 * 60_000);
    expect(await status(await post(h, a, same))).toBe('sent');
  });

  it('let the same text stand in another channel', async () => {
    const { h, a } = await setup();
    await seedChannel(h.relay, { id: BENCH, name: 'bench', access: 'post', pace: 120 });
    await post(h, a, same);
    expect(await status(await post(h, a, same, {}, BENCH))).toBe('sent');
  });

  it('not treat a blocked or failed earlier try as having said it', async () => {
    const moderator = mod((req) => (req.content.includes('first') ? { verdict: 'block', policy_code: 'other' } : pass));
    const { h, a } = await setup({ moderator });
    const first = await json(await post(h, a, 'first draft of the thing'));
    expect(first.status).toBe('blocked');
    const resend = await json(await post(h, a, 'first draft of the thing'));
    expect(resend.policy_code).toBe('other');
    expect(moderator.calls).toHaveLength(2);
  });
});

describe('rate limits', () => {
  it('stop an agent at its posts per minute, with a 429, a policy code and a wait', async () => {
    const { h, a } = await setup();
    for (let i = 0; i < 20; i++) expect((await post(h, a, `message number ${i}`)).status).toBe(201);
    const res = await post(h, a, 'one too many');
    expect(res.status).toBe(429);
    const body = await json(res);
    expect(body).toMatchObject({ code: 'rate_limited', policy_code: 'rate_limit' });
    expect(body.detail).toMatch(/20 messages a minute/);
    expect(Number(res.headers.get('retry-after'))).toBeGreaterThan(0);
    h.advance(61_000);
    expect((await post(h, a, 'one too many')).status).toBe(201);
  });

  it('stop an agent at its posts per day', async () => {
    const { h, a } = await setup();
    const window = Math.floor(h.now().getTime() / 1000 / 86_400) * 86_400;
    await h.db.prepare('INSERT INTO rate_counters (key, window_start, count) VALUES (?, ?, 1000)').bind(`post:${a.id}:d`, window).run();
    const res = await post(h, a, 'tomorrow, perhaps');
    expect(res.status).toBe(429);
    expect((await json(res)).detail).toMatch(/1000 messages a day/);
  });

  it('apply the channel’s pace per agent, not across agents', async () => {
    const { h, a } = await setup({}, {}, { pace: 2 });
    const b = await seedAgent(h.relay, { tier: 'claimed' });
    expect((await post(h, a, 'one')).status).toBe(201);
    expect((await post(h, a, 'two')).status).toBe(201);
    const third = await post(h, a, 'three');
    expect(third.status).toBe(429);
    expect((await json(third)).detail).toMatch(/allows each agent 2 messages a minute/);
    expect((await post(h, b, 'one from b')).status).toBe(201);
  });

  it('does not let refusals in a busy channel use up the agent’s budget for the others', async () => {
    const { h, a } = await setup({}, {}, { pace: 1 });
    await seedChannel(h.relay, { id: BENCH, name: 'bench', access: 'post', pace: 120 });
    expect((await post(h, a, 'the one this minute')).status).toBe(201);
    for (let i = 0; i < 5; i++) expect((await post(h, a, `refused ${i}`)).status).toBe(429);
    const count = (key: string) =>
      h.db
        .prepare('SELECT count FROM rate_counters WHERE key = ?')
        .bind(key)
        .first<{ count: number }>()
        .then((r) => r?.count);
    expect(await count(`post:${a.id}:m`)).toBe(1);
    expect(await count(`pace:${a.id}:${LOUNGE}:m`)).toBe(1);
    expect(await count(`attempt:${a.id}:m`)).toBe(6);
    expect((await post(h, a, 'elsewhere is fine', {}, BENCH)).status).toBe(201);
  });

  it('let no agent post where the pace is zero', async () => {
    const { h, a } = await setup({}, {}, { pace: 0 });
    const res = await post(h, a, 'anyone home?');
    expect(res.status).toBe(403);
    expect((await json(res)).detail).toMatch(/can’t post in this channel/);
  });

  it('share an hourly budget among agents on probation on one network, claimed or not, and spare trusted ones', async () => {
    const { h } = await setup();
    const fresh = await authenticateKey(h.relay, (await seedAgent(h.relay, { tier: 'new', probationUntil: future(h) })).key, NO_CLIENT);
    const claimedOnProbation = await authenticateKey(h.relay, (await seedAgent(h.relay, { tier: 'claimed' })).key, NO_CLIENT);
    const claimed = await authenticateKey(h.relay, (await seedAgent(h.relay, { tier: 'trusted' })).key, NO_CLIENT);
    const window = Math.floor(h.now().getTime() / 1000 / 3600) * 3600;
    await h.db.prepare('INSERT INTO rate_counters (key, window_start, count) VALUES (?, ?, 100)').bind('post:net:netA:h', window).run();
    const req = (text: string) => ({ channel_id: LOUNGE, content: text });
    const k = () => ({ idempotencyKey: `key-${++counter}-padding` });
    await expect(sendMessage(h.relay, fresh, req('from the crowded network'), { ...k(), net: 'netA' })).rejects.toMatchObject({
      status: 429,
      policy: 'rate_limit',
    });
    expect((await sendMessage(h.relay, fresh, req('from another network'), { ...k(), net: 'netB' })).message.status).toBe('sent');
    expect((await sendMessage(h.relay, fresh, req('from no known network'), { ...k(), net: null })).message.status).toBe('sent');
    await expect(sendMessage(h.relay, claimedOnProbation, req('claiming does not lift it'), { ...k(), net: 'netA' })).rejects.toMatchObject({
      status: 429,
      policy: 'rate_limit',
    });
    expect((await sendMessage(h.relay, claimed, req('trusted agents are not budgeted'), { ...k(), net: 'netA' })).message.status).toBe('sent');
  });

  it('count blocked attempts on a looser counter, so blocked spam runs out too', async () => {
    const { h, a } = await setup();
    for (let i = 0; i < 40; i++) {
      const res = await post(h, a, `free stuff at discord.gg/spam${i}`);
      expect(res.status, `attempt ${i}`).toBe(200);
    }
    const posts = await h.db.prepare("SELECT COUNT(*) AS n FROM rate_counters WHERE key LIKE 'post:%'").first<{ n: number }>();
    expect(posts!.n).toBe(0);
    const res = await post(h, a, 'free stuff at discord.gg/spam41');
    expect(res.status).toBe(429);
    const body = await json(res);
    expect(body).toMatchObject({ code: 'rate_limited', policy_code: 'flood' });
    expect(body.detail).toMatch(/refused ones/);
    expect(Number(res.headers.get('retry-after'))).toBeGreaterThan(0);
    // Nothing was stored for the refused 41st attempt, and the log names why.
    expect((await h.db.prepare('SELECT COUNT(*) AS n FROM relay_messages').first<{ n: number }>())!.n).toBe(40);
    expect(await h.db.prepare("SELECT layer, verdict, policy_code FROM moderation_log WHERE policy_code = 'flood'").first()).toEqual({
      layer: 'admission',
      verdict: 'block',
      policy_code: 'flood',
    });
    h.advance(61_000);
    expect((await post(h, a, 'back to normal')).status).toBe(201);
  });
});

describe('the loop breaker', () => {
  let snowflake = 400000000000000000n;
  const converse = async (h: Harness, rows: { agent: string | null; kind?: string; minutesAgo: number; thread?: string | null }[]) => {
    for (const r of rows) {
      snowflake += 1n;
      await h.db
        .prepare(
          "INSERT INTO conversation (message_id, channel_id, thread_id, author_kind, agent_id, author_ref, discord_user_id, display_name, content, created_at) VALUES (?, ?, ?, ?, ?, 'p_x', NULL, ?, 'blah', ?)",
        )
        .bind(
          String(snowflake),
          LOUNGE,
          r.thread ?? null,
          r.kind ?? 'agent',
          r.agent,
          r.agent ?? 'someone',
          new Date(h.now().getTime() - r.minutesAgo * 60_000).toISOString(),
        )
        .run();
    }
  };
  /** Oldest first, alternating a and b, the newest `gap` minutes ago. */
  const pingPong = (a: string, b: string, n: number, opts: { gap?: number; thread?: string | null } = {}) =>
    Array.from({ length: n }, (_, i) => ({ agent: (n - i) % 2 === 1 ? b : a, minutesAgo: (opts.gap ?? 0) + (n - 1 - i) * 0.5, thread: opts.thread ?? null }));

  async function pair() {
    const ctx = await setup();
    const b = await seedAgent(ctx.h.relay, { tier: 'claimed' });
    const c = await seedAgent(ctx.h.relay, { tier: 'claimed' });
    return { ...ctx, b, c };
  }

  it('refuse a 429 with policy loop, a wait of two minutes and a sentence to act on', async () => {
    const { h, a, b } = await pair();
    await converse(h, pingPong(a.id, b.id, 12));
    const res = await post(h, a, 'and another thing');
    expect(res.status).toBe(429);
    expect(res.headers.get('retry-after')).toBe('120');
    const body = await json(res);
    expect(body).toMatchObject({
      code: 'rate_limited',
      policy_code: 'loop',
      detail: 'This thread has been two agents back and forth for a while. Wait for someone else to speak.',
    });
    expect((await post(h, b, 'my turn again')).status).toBe(429);
    expect(h.discordCalls).toHaveLength(0);
    expect(await h.db.prepare("SELECT layer, verdict, policy_code, message_id FROM moderation_log WHERE policy_code = 'loop' LIMIT 1").first()).toEqual({
      layer: 'admission',
      verdict: 'block',
      policy_code: 'loop',
      message_id: null,
    });
  });

  it('start at eight alternations and not before', async () => {
    const one = await pair();
    await converse(one.h, pingPong(one.a.id, one.b.id, 9));
    expect((await post(one.h, one.a, 'nine in a row')).status).toBe(429);
    const two = await pair();
    await converse(two.h, pingPong(two.a.id, two.b.id, 8));
    expect((await post(two.h, two.a, 'only eight in a row')).status).toBe(201);
  });

  it('let a third agent speak, and end the loop for the two', async () => {
    const { h, a, b, c } = await pair();
    await converse(h, pingPong(a.id, b.id, 12));
    expect((await post(h, c, 'may I join?')).status).toBe(201);
  });

  it('end when a person has spoken among the last twelve', async () => {
    const { h, a, b } = await pair();
    await converse(h, [{ agent: null, kind: 'human', minutesAgo: 6 }, ...pingPong(a.id, b.id, 11)]);
    expect((await post(h, a, 'with a person nearby')).status).toBe(201);
  });

  it('end when a bot or webhook is among them', async () => {
    const { h, a, b } = await pair();
    await converse(h, [{ agent: null, kind: 'webhook', minutesAgo: 6 }, ...pingPong(a.id, b.id, 11)]);
    expect((await post(h, a, 'with a webhook nearby')).status).toBe(201);
  });

  it('ignore a back-and-forth that is more than ten minutes old', async () => {
    const { h, a, b } = await pair();
    await converse(h, pingPong(a.id, b.id, 12, { gap: 9 }));
    expect((await post(h, a, 'long ago')).status).toBe(201);
  });

  it('need strict alternation at the newest end', async () => {
    const { h, a, b } = await pair();
    await converse(h, [...pingPong(a.id, b.id, 12), { agent: b.id, minutesAgo: 0 }]);
    // b spoke twice in a row last, so the run of alternation is one.
    expect((await post(h, a, 'b was repeating itself')).status).toBe(201);
  });

  it('look only at the thread the message would land in', async () => {
    const { h, a, b } = await pair();
    await converse(h, pingPong(a.id, b.id, 12, { thread: '120000000000000001' }));
    expect((await post(h, a, 'in the channel itself')).status).toBe(201);
    expect((await post(h, a, 'in the busy thread', { thread_id: '120000000000000001' })).status).toBe(429);
    expect((await post(h, a, 'in another thread', { thread_id: '120000000000000002' })).status).toBe(201);
  });
});

describe('the classifier', () => {
  it('asks Jev/Laya with the recent conversation, the tier, the strike count and the thread name', async () => {
    const moderator = mod();
    const { h, a } = await setup({ moderator }, { name: 'Orrery' }, { type: 'forum', access: 'post_new_threads' });
    const ANN = '700000000000000001';
    const LATE = '700000000000000002';
    await agree(h, ANN, { at: '2026-10-19T00:00:00.000Z' });
    // LATE agreed only after writing line 11; nobody ever agreed for 8; 4 was withheld at intake.
    await agree(h, LATE, { at: new Date(h.now().getTime() - 1500).toISOString() });
    for (let i = 1; i <= 12; i++) {
      const hidden = i === 4;
      await h.db
        .prepare(
          "INSERT INTO conversation (message_id, channel_id, thread_id, author_kind, agent_id, author_ref, discord_user_id, display_name, content, created_at, withheld) VALUES (?, ?, '120000000000000001', 'human', NULL, ?, ?, ?, ?, ?, ?)",
        )
        .bind(
          String(500000000000000000n + BigInt(i)),
          LOUNGE,
          hidden ? 'p_withheld' : 'p_x',
          hidden ? null : i === 11 ? LATE : i === 8 ? '700000000000000003' : ANN,
          hidden ? 'A person in Discord' : `Person ${i}`,
          hidden ? null : `line ${i}`,
          new Date(h.now().getTime() - (13 - i) * 1000).toISOString(),
          Number(hidden),
        )
        .run();
    }
    await h.db
      .prepare(
        "INSERT INTO conversation (message_id, channel_id, thread_id, author_kind, agent_id, author_ref, display_name, content, created_at, deleted_at) VALUES (?, ?, '120000000000000001', 'human', NULL, 'p_x', 'Gone', 'deleted words', ?, ?)",
      )
      .bind('500000000000000100', LOUNGE, h.now().toISOString(), h.now().toISOString())
      .run();
    await h.db
      .prepare("INSERT INTO strikes (id, agent_id, policy_code, created_by, created_at, expires_at) VALUES ('stk_AAAAAAAAAA', ?, 'other', 'system', ?, ?)")
      .bind(a.id, h.now().toISOString(), future(h, 100))
      .run();

    const res = await post(h, a, 'replying here', { thread_id: '120000000000000001' });
    expect(res.status).toBe(201);
    const req = moderator.calls[0]!;
    expect(req).toMatchObject({ agent_id: a.id, tier: 'claimed', channel_id: LOUNGE, kind: 'message', content: 'replying here', strikes: 1 });
    expect(req.message_id).toBe((await json(res)).id);
    // The twelve newest rows were read (the deleted one and lines 2 to 12); the withheld one, the stranger's and the one written
    // before LATE agreed are not passed on.
    expect(req.context!.map((c) => c.author)).toEqual(['Person 2', 'Person 3', 'Person 5', 'Person 6', 'Person 7', 'Person 9', 'Person 10', 'Person 12']);
    expect(req.context![7]).toEqual({ author: 'Person 12', content: 'line 12' });
    expect(req.context!.some((c) => c.content === 'deleted words')).toBe(false);
    expect(JSON.stringify(req.context)).not.toMatch(/A person in Discord|Person 8|Person 11/);

    await post(h, a, 'starting a thread', { thread_name: 'Weekly sync' });
    // A new thread has no conversation yet, and the channel's other messages aren't read for it.
    expect(moderator.calls[1]).toMatchObject({ thread_name: 'Weekly sync', context: [] });
  });

  it('asks Workers AI only when Jev/Laya is unavailable, and uses its answer', async () => {
    const primary = mod(down);
    const fallback = mod({ verdict: 'block', policy_code: 'violence' });
    const { h, a } = await setup({ moderator: primary, fallbackModerator: fallback });
    const msg = await json(await post(h, a, 'a message the fallback judges'));
    expect(msg).toMatchObject({ status: 'blocked', policy_code: 'violence' });
    expect(primary.calls).toHaveLength(1);
    expect(fallback.calls).toHaveLength(1);
    expect((await logOf(h, msg.id)).find((l) => l.layer === 'classifier')!.source).toBe('fallback');
  });

  it('does not ask the fallback when Jev/Laya answers', async () => {
    const primary = mod({ verdict: 'hold', policy_code: 'sexual' });
    const fallback = mod(pass);
    const { h, a } = await setup({ moderator: primary, fallbackModerator: fallback });
    const msg = await json(await post(h, a, 'a message jev judges'));
    expect(msg).toMatchObject({ status: 'held', verdict: 'hold', policy_code: 'sexual' });
    expect(fallback.calls).toHaveLength(0);
  });

  it('treats a classifier that throws as unavailable', async () => {
    const primary: Moderator = {
      review: async () => {
        throw new Error('boom');
      },
    };
    const fallback = mod(pass);
    const { h, a } = await setup({ moderator: primary, fallbackModerator: fallback });
    expect(await status(await post(h, a, 'jev has crashed'))).toBe('sent');
  });

  it('gives a sentence for a block even when the classifier gave only a verdict', async () => {
    const { h, a } = await setup({ moderator: mod({ verdict: 'block' }) });
    const msg = await json(await post(h, a, 'something the classifier dislikes'));
    expect(msg).toMatchObject({ status: 'blocked', policy_code: 'other' });
    expect(msg.status_reason.length).toBeGreaterThan(20);
  });

  it('keeps the classifier’s own note for reviewers and never shows it to the agent', async () => {
    const { h, a } = await setup({ moderator: mod({ verdict: 'hold', policy_code: 'privacy', reason: 'names a private individual' }) });
    const msg = await json(await post(h, a, 'about a particular person'));
    expect(msg.status_reason).toMatch(/private information/);
    expect(msg.status_reason).toMatch(/held for a reviewer/);
    expect(msg.status_reason).not.toContain('names a private individual');
    expect(msg.status_reason).not.toMatch(/Moderator note|rephrase|try again/i);
    const logged = await h.db.prepare("SELECT reason FROM moderation_log WHERE layer = 'classifier'").first<{ reason: string }>();
    expect(logged!.reason).toContain('Moderator note: names a private individual');
  });

  it('says a block was not posted and what to change, and a hold that a reviewer has it', async () => {
    const blocked = await setup({ moderator: mod({ verdict: 'block', policy_code: 'harassment' }) });
    const b = await json(await post(blocked.h, blocked.a, 'you are all idiots'));
    expect(b.status_reason).toMatch(/It was not posted\./);
    expect(b.status_reason).toMatch(/Disagree with ideas/);
    expect(b.status_reason).not.toMatch(/held/);
    const held = await setup({ moderator: mod({ verdict: 'hold', policy_code: 'sexual' }) });
    const hd = await json(await post(held.h, held.a, 'something borderline'));
    expect(hd.status_reason).toMatch(/held for a reviewer/);
    expect(hd.status_reason).not.toMatch(/not posted|rephrase|try again/i);
  });

  describe('when nothing answers', () => {
    it('holds the message for an automatic re-check by default', async () => {
      const { h, a } = await setup({ moderator: mod(down), fallbackModerator: mod(down) });
      const res = await post(h, a, 'nobody can judge this right now');
      expect(res.status).toBe(202);
      const msg = await json(res);
      expect(msg).toMatchObject({ status: 'held', verdict: 'hold', policy_code: 'outage' });
      expect(msg.status_reason).toMatch(/checked again automatically/);
      const stored = await h.db
        .prepare('SELECT held_kind, next_review_at, review_attempts FROM relay_messages')
        .first<{ held_kind: string; next_review_at: string; review_attempts: number }>();
      expect(stored).toEqual({ held_kind: 'outage', next_review_at: new Date(h.now().getTime() + 60_000).toISOString(), review_attempts: 0 });
      const log = (await logOf(h, msg.id)).find((l) => l.layer === 'classifier')!;
      expect(log).toMatchObject({ verdict: 'hold', policy_code: 'outage', source: 'none' });
      expect(log.reason).toContain('it is down');
      expect(h.discordCalls).toHaveLength(0);
    });

    it('holds when there is no fallback at all', async () => {
      const { h, a } = await setup({ moderator: mod(down), fallbackModerator: null });
      expect(await status(await post(h, a, 'jev only, and it is down'))).toBe('held');
    });

    it('refuses with a 503 when the relay is set to refuse, and the same key works once moderation is back', async () => {
      let healthy = false;
      const { h, a } = await setup({ moderator: mod(() => (healthy ? pass : down)), fallbackModerator: null });
      h.relay.config.moderationOutage = 'refuse';
      const k = 'refused-then-ok-key';
      const send = () => h.call('POST', '/v1/messages', { channel_id: LOUNGE, content: 'try me twice' }, { ...h.as(a.key), 'idempotency-key': k });
      const res = await send();
      expect(res.status).toBe(503);
      expect(Number(res.headers.get('retry-after'))).toBeGreaterThan(0);
      expect(await json(res)).toMatchObject({ code: 'moderation_unavailable', policy_code: 'outage' });
      expect(h.discordCalls).toHaveLength(0);
      const stored = await h.db.prepare('SELECT status, policy_code FROM relay_messages').first();
      expect(stored).toEqual({ status: 'failed', policy_code: 'outage' });

      healthy = true;
      const ok = await send();
      expect(ok.status).toBe(201);
      expect(await status(ok)).toBe('sent');
      expect((await h.db.prepare('SELECT COUNT(*) AS n FROM relay_messages').first<{ n: number }>())!.n).toBe(1);
    });
  });
});
