import { LIMITS, newId } from '@logitland/contracts';
import { describe, expect, it, vi } from 'vitest';
import { handleScheduled } from './jobs';
import type { ModerationResult, Moderator } from './services/moderation/classifier';
import { UNCONFIRMED_REASON } from './services/moderation/rows';
import { reviewHeldJob } from './services/review';
import { sweepStuckJob } from './services/sending';
import { LOUNGE, harness, seedAgent, seedChannel, type Harness } from './testing';

vi.mock('./services/intake', async (original) => ({ ...(await original<typeof import('./services/intake')>()), recordAgentPost: vi.fn(async () => {}) }));

const down: ModerationResult = { verdict: null, unavailable: true, reason: 'it is down' };

/** A classifier whose answer the test changes as it goes. */
function control(initial: ModerationResult = down) {
  const state = { answer: initial, calls: 0 };
  const moderator: Moderator = {
    review: async () => {
      state.calls++;
      return state.answer;
    },
  };
  return { state, moderator };
}

async function setup(initial: ModerationResult = down) {
  const c = control(initial);
  const h = harness({ moderator: c.moderator });
  await seedChannel(h.relay, { id: LOUNGE, access: 'post', pace: 120 });
  const a = await seedAgent(h.relay);
  return { h, a, ...c };
}

let counter = 0;
const post = (h: Harness, a: { token: string }, text: string, key = `key-${++counter}-padding`) =>
  h.call('POST', '/v1/messages', { channel_id: LOUNGE, content: text }, { ...h.as(a.token), 'idempotency-key': key });
const json = async (res: Response) => (await res.json()) as Record<string, any>;
const row = (h: Harness, id: string) => h.db.prepare('SELECT * FROM relay_messages WHERE id = ?').bind(id).first<Record<string, any>>();
const minutes = (h: Harness, n: number) => h.advance(n * 60_000);
const logOf = (h: Harness, id: string) =>
  h.db
    .prepare('SELECT layer, verdict, policy_code, reason, source FROM moderation_log WHERE message_id = ? ORDER BY id')
    .bind(id)
    .all<Record<string, any>>()
    .then((r) => r.results);

describe('re-checking outage holds', () => {
  it('waits for the first delay, then passes the message and sends it', async () => {
    const { h, a, state } = await setup();
    const held = await json(await post(h, a, 'check me when you can'));
    expect(held).toMatchObject({ status: 'held', policy_code: 'outage' });
    state.answer = { verdict: 'pass' };

    minutes(h, 1);
    h.advance(-1000);
    expect(await reviewHeldJob(h.relay)).toBe(0);
    expect(h.discordCalls).toHaveLength(0);

    h.advance(1000);
    expect(await reviewHeldJob(h.relay)).toBe(1);
    expect(await row(h, held.id)).toMatchObject({ status: 'sent', verdict: 'pass', policy_code: null, held_kind: null, next_review_at: null });
    expect(h.discordCalls).toHaveLength(1);
    expect((await logOf(h, held.id)).find((l) => l.layer === 'review')).toMatchObject({ verdict: 'pass', source: 'primary' });
    expect(await reviewHeldJob(h.relay)).toBe(0);
  });

  it('blocks the message when the classifier now says block, with its policy and a strike for the severe ones', async () => {
    const { h, a, state } = await setup();
    const held = await json(await post(h, a, 'judge me later'));
    state.answer = { verdict: 'block', policy_code: 'hate' };
    minutes(h, 1);
    await reviewHeldJob(h.relay);
    const after = await row(h, held.id);
    expect(after).toMatchObject({ status: 'blocked', verdict: 'block', policy_code: 'hate', held_kind: null });
    expect(after!.status_reason).toMatch(/hateful/);
    expect(after!.status_reason).toMatch(/warning/);
    expect((await h.db.prepare('SELECT COUNT(*) AS n FROM strikes WHERE agent_id = ?').bind(a.id).first<{ n: number }>())!.n).toBe(1);
    expect(h.discordCalls).toHaveLength(0);
  });

  it('turns it into a reviewer hold when the classifier says hold, and stops re-checking it', async () => {
    const { h, a, state } = await setup();
    const held = await json(await post(h, a, 'borderline words'));
    state.answer = { verdict: 'hold', policy_code: 'sexual' };
    minutes(h, 1);
    await reviewHeldJob(h.relay);
    expect(await row(h, held.id)).toMatchObject({ status: 'held', held_kind: 'review', policy_code: 'sexual', next_review_at: null });
    const calls = state.calls;
    minutes(h, 120);
    await reviewHeldJob(h.relay);
    expect(state.calls).toBe(calls);
  });

  it('backs off 1, 2, 5, 10, 30 and then 60 minutes while moderation stays down', async () => {
    const { h, a } = await setup();
    const held = await json(await post(h, a, 'still waiting for moderation'));
    // The first re-check is due a minute after the hold; each failed one sets the delay for the next.
    const waits = [1, 2, 5, 10, 30, 60, 60, 60, 60, 60, 60];
    let wait = 1;
    for (const [i, next] of waits.entries()) {
      h.advance(wait * 60_000 - 1000);
      expect(await reviewHeldJob(h.relay), `not yet due for re-check ${i + 1}`).toBe(0);
      h.advance(1000);
      expect(await reviewHeldJob(h.relay), `re-check ${i + 1}`).toBe(1);
      const r = (await row(h, held.id))!;
      expect(r).toMatchObject({ status: 'held', held_kind: 'outage', review_attempts: i + 1 });
      expect(r.next_review_at).toBe(new Date(h.now().getTime() + next * 60_000).toISOString());
      wait = next;
    }
  });

  it('gives up after the allowed attempts, tells the agent to send it again, and accepts the same key later', async () => {
    const { h, a, state } = await setup();
    const k = 'key-outage-expiry-padding';
    const held = await json(await post(h, a, 'moderation never came back', k));
    let failed = false;
    for (let i = 0; i < LIMITS.outageRecheckAttempts + 2 && !failed; i++) {
      minutes(h, 61);
      await reviewHeldJob(h.relay);
      failed = (await row(h, held.id))!.status === 'failed';
    }
    expect(failed).toBe(true);
    const r = (await row(h, held.id))!;
    expect(r).toMatchObject({
      status: 'failed',
      verdict: null,
      policy_code: 'outage',
      held_kind: null,
      next_review_at: null,
      review_attempts: LIMITS.outageRecheckAttempts,
    });
    expect(r.status_reason).toBe('Moderation stayed unavailable; send it again later.');
    expect((await logOf(h, held.id)).at(-1)).toMatchObject({ layer: 'review', verdict: 'block', policy_code: 'outage' });

    const callsBefore = state.calls;
    minutes(h, 600);
    await reviewHeldJob(h.relay);
    expect(state.calls).toBe(callsBefore);

    state.answer = { verdict: 'pass' };
    const retry = await post(h, a, 'moderation never came back', k);
    expect(retry.status).toBe(201);
    expect((await json(retry)).id).toBe(held.id);
  });

  it('re-checks a message once even when two runs overlap', async () => {
    const { h, a, state } = await setup();
    await post(h, a, 'two crons at once');
    state.answer = { verdict: 'pass' };
    minutes(h, 1);
    const calls = state.calls;
    const [x, y] = await Promise.all([reviewHeldJob(h.relay), reviewHeldJob(h.relay)]);
    expect(x + y).toBe(1);
    expect(state.calls).toBe(calls + 1);
    expect(h.discordCalls).toHaveLength(1);
  });

  it('runs from the scheduled job', async () => {
    const { h, a, state } = await setup();
    const held = await json(await post(h, a, 'cron will get this'));
    state.answer = { verdict: 'pass' };
    minutes(h, 2);
    const out = await handleScheduled(h.relay);
    expect(out.held).toBe(1);
    expect((await row(h, held.id))!.status).toBe('sent');
  });
});

describe('reviewer holds that nobody reviews', () => {
  it('become blocked with policy manual after 72 hours', async () => {
    const { h, a } = await setup({ verdict: 'pass' });
    const held = await json(await post(h, a, 'write to me at someone@example.com'));
    expect(held).toMatchObject({ status: 'held', policy_code: 'personal_info' });
    h.advance(LIMITS.heldReviewHours * 3_600_000);
    expect(await reviewHeldJob(h.relay)).toBe(0);
    expect((await row(h, held.id))!.status).toBe('held');
    h.advance(1000);
    expect(await reviewHeldJob(h.relay)).toBe(1);
    const r = (await row(h, held.id))!;
    expect(r).toMatchObject({ status: 'blocked', verdict: 'block', policy_code: 'manual', status_reason: 'Not reviewed within 72 hours', held_kind: null });
    expect((await logOf(h, held.id)).at(-1)).toMatchObject({ layer: 'review', verdict: 'block', policy_code: 'manual', source: 'expiry' });
    expect(h.discordCalls).toHaveLength(0);
  });

  it('are left alone before then', async () => {
    const { h, a } = await setup({ verdict: 'pass' });
    const held = await json(await post(h, a, 'write to me at someone@example.com'));
    h.advance(70 * 3_600_000);
    expect(await reviewHeldJob(h.relay)).toBe(0);
    expect((await row(h, held.id))!.status).toBe('held');
  });
});

describe('stuck messages', () => {
  async function insert(h: Harness, agentId: string, status: string, agoMinutes: number) {
    const id = newId('message');
    const at = new Date(h.now().getTime() - agoMinutes * 60_000).toISOString();
    await h.db
      .prepare(
        "INSERT INTO relay_messages (id, agent_id, channel_id, content, status, idempotency_key, payload_digest, content_hash, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, 'digest', ?, ?, ?)",
      )
      .bind(id, agentId, LOUNGE, `stuck ${id}`, status, `key-${id}`, `hash-${id}`, at, at)
      .run();
    return id;
  }

  it('send a moderating message back through review, which then classifies and sends it', async () => {
    const { h, a, state } = await setup({ verdict: 'pass' });
    const id = await insert(h, a.id, 'moderating', 6);
    const fresh = await insert(h, a.id, 'moderating', 2);
    expect(await sweepStuckJob(h.relay)).toBe(1);
    expect(await row(h, id)).toMatchObject({
      status: 'held',
      held_kind: 'outage',
      policy_code: 'outage',
      review_attempts: 0,
      next_review_at: h.now().toISOString(),
    });
    expect((await row(h, fresh))!.status).toBe('moderating');
    expect((await logOf(h, id)).at(-1)).toMatchObject({ layer: 'review', verdict: 'hold', policy_code: 'outage', source: 'sweep' });

    expect(await reviewHeldJob(h.relay)).toBe(1);
    expect(state.calls).toBe(1);
    expect((await row(h, id))!.status).toBe('sent');
  });

  it('make a sending message uncertain, since it may have posted', async () => {
    const { h, a } = await setup();
    const stale = await insert(h, a.id, 'sending', 6);
    const fresh = await insert(h, a.id, 'sending', 1);
    expect(await sweepStuckJob(h.relay)).toBe(1);
    const r = (await row(h, stale))!;
    expect(r.status).toBe('uncertain');
    expect(r.status_reason).toMatch(/may or may not/);
    expect((await row(h, fresh))!.status).toBe('sending');
    expect(h.discordCalls).toHaveLength(0);
  });

  it('mark a send failed once it has stayed uncertain for 10 minutes', async () => {
    const { h, a } = await setup();
    const stale = await insert(h, a.id, 'uncertain', 11);
    const fresh = await insert(h, a.id, 'uncertain', 9);
    expect(await sweepStuckJob(h.relay)).toBe(1);
    expect(await row(h, stale)).toMatchObject({ status: 'failed', status_reason: UNCONFIRMED_REASON });
    expect((await row(h, fresh))!.status).toBe('uncertain');
    expect(h.discordCalls).toHaveLength(0);
  });

  it('leave finished messages alone', async () => {
    const { h, a } = await setup();
    for (const status of ['sent', 'blocked', 'failed', 'removed']) await insert(h, a.id, status, 600);
    expect(await sweepStuckJob(h.relay)).toBe(0);
  });
});
