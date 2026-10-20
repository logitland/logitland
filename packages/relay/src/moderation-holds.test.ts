import { describe, expect, it, vi } from 'vitest';
import { reviewHeldJob } from './services/review';
import { activeStrikeCount } from './services/strikes';
import { down, json, key, mod, pass, post, row, say, world } from './posting-fixtures';
import { ADMIN_DISCORD, seedAgent, seedOwner, type Harness } from './testing';

vi.mock('./services/intake', async (original) => ({ ...(await original<typeof import('./services/intake')>()), recordAgentPost: vi.fn(async () => {}) }));

const status = async (res: Response) => (await json(res)).status as string;
const held = (h: Harness, agent: { key: string }, tag: string) => post(h, agent, say(`write to ${tag}@example.com about it`));
const heldCount = async (h: Harness, agentId: string) =>
  (await h.db.prepare("SELECT COUNT(*) AS n FROM relay_messages WHERE agent_id = ? AND status = 'held'").bind(agentId).first<{ n: number }>())!.n;
const adminCall = async (h: Harness, method: string, path: string, body: unknown = {}) =>
  h.internal(method, path, body, {
    'x-logitland-owner': (await h.db.prepare('SELECT id FROM owners WHERE discord_user_id = ?').bind(ADMIN_DISCORD).first<{ id: string }>())!.id,
  });

describe('the cross-agent copy hold has a minimum length', () => {
  const agents = async (w: Awaited<ReturnType<typeof world>>) => [
    w.a,
    await seedAgent(w.h.relay, { tier: 'claimed' }),
    await seedAgent(w.h.relay, { tier: 'claimed' }),
  ];

  it('lets three agents say "thanks" in the same ten minutes', async () => {
    const w = await world();
    for (const agent of await agents(w)) expect(await status(await post(w.h, agent, say('Thanks!')))).toBe('sent');
    for (const agent of await agents(w)) expect(await status(await post(w.h, agent, say('ok sounds good')))).toBe('sent');
  });

  it('still holds the third copy of a text of at least 20 normalised characters', async () => {
    const w = await world();
    const [a, b, c] = await agents(w);
    expect(await status(await post(w.h, a!, say('abcdefghijklmnopqrst')))).toBe('sent');
    expect(await status(await post(w.h, b!, say('ABCDEFGHIJKLMNOPQRST')))).toBe('sent');
    const third = await json(await post(w.h, c!, say('  abcdefghijklmnopqrst \n')));
    expect(third).toMatchObject({ status: 'held', policy_code: 'duplicate' });
  });

  it('measures the normalised text: 19 characters is exempt, however it is spaced', async () => {
    const w = await world();
    const [a, b, c] = await agents(w);
    expect(await status(await post(w.h, a!, say('abcdefghijklmnopqrs')))).toBe('sent');
    expect(await status(await post(w.h, b!, say('abcdefghijklmnopqrs')))).toBe('sent');
    expect(await status(await post(w.h, c!, say('   ABCDEFGHIJKLMNOPQRS    ')))).toBe('sent');
  });

  it('counts collapsed whitespace once, so padding does not push a short text over', async () => {
    const w = await world();
    const [a, b, c] = await agents(w);
    const short = 'ok   so   it   is';
    for (const agent of [a!, b!, c!]) expect(await status(await post(w.h, agent, say(short)))).toBe('sent');
  });

  it('keeps blocking one agent who repeats itself, however short', async () => {
    const w = await world();
    expect(await status(await post(w.h, w.a, say('thanks')))).toBe('sent');
    expect(await json(await post(w.h, w.a, say('thanks')))).toMatchObject({ status: 'blocked', policy_code: 'duplicate' });
  });
});

describe('the cap on messages waiting for a reviewer', () => {
  async function fill(w: Awaited<ReturnType<typeof world>>, n = 10, agent = w.a, from = 0) {
    for (let i = from; i < from + n; i++) expect(await status(await held(w.h, agent, `person${i}`))).toBe('held');
  }

  it('lets an agent have ten, and refuses the eleventh that would need review with a 429', async () => {
    const w = await world();
    await fill(w);
    const res = await held(w.h, w.a, 'person10');
    expect(res.status).toBe(429);
    expect(res.headers.get('retry-after')).toBe('300');
    const problem = await json(res);
    expect(problem).toMatchObject({ code: 'rate_limited', policy_code: 'rate_limit' });
    expect(problem.detail).toBe(
      'You already have 10 messages waiting for review. Wait until some are reviewed before sending more that need review. Messages that don’t need review are not affected.',
    );
    expect(await heldCount(w.h, w.a.id)).toBe(10);
    expect((await w.h.db.prepare('SELECT COUNT(*) AS n FROM relay_messages').first<{ n: number }>())!.n).toBe(10);
    const logged = await w.h.db.prepare("SELECT layer, verdict, policy_code FROM moderation_log WHERE policy_code = 'rate_limit'").first();
    expect(logged).toEqual({ layer: 'admission', verdict: 'block', policy_code: 'rate_limit' });
  });

  it('does not touch messages that need no review', async () => {
    const w = await world();
    await fill(w);
    expect(await status(await post(w.h, w.a, say('A perfectly ordinary message')))).toBe('sent');
    // Blocks are final, not waiting, so they are not capped either.
    expect(await status(await post(w.h, w.a, say('join discord.gg/abc123')))).toBe('blocked');
  });

  it('is per agent', async () => {
    const w = await world();
    await fill(w);
    const other = await seedAgent(w.h.relay, { tier: 'claimed' });
    expect(await status(await held(w.h, other, 'someoneelse'))).toBe('held');
  });

  it('makes room as messages are reviewed, deleted or expire', async () => {
    const w = await world();
    await seedOwner(w.h.relay, ADMIN_DISCORD, 'admin');
    const ids: string[] = [];
    for (let i = 0; i < 10; i++) ids.push((await json(await held(w.h, w.a, `person${i}`))).id);
    expect((await held(w.h, w.a, 'blocked-for-now')).status).toBe(429);
    expect((await adminCall(w.h, 'POST', `/internal/admin/messages/${ids[0]}/release`)).status).toBe(200);
    expect(await status(await held(w.h, w.a, 'after-release'))).toBe('held');
    expect((await held(w.h, w.a, 'full-again')).status).toBe(429);
    expect((await w.h.call('DELETE', `/v1/messages/${ids[1]}`, undefined, w.h.as(w.a.key))).status).toBe(200);
    expect(await status(await held(w.h, w.a, 'after-delete'))).toBe('held');
    expect((await held(w.h, w.a, 'full-once-more')).status).toBe(429);
    w.h.advance(73 * 3_600_000);
    expect(await reviewHeldJob(w.h.relay)).toBe(10);
    expect(await status(await held(w.h, w.a, 'after-expiry'))).toBe('held');
  });

  it('applies to holds that come from the duplicate check, too', async () => {
    const w = await world();
    await fill(w);
    const [b, c] = [await seedAgent(w.h.relay, { tier: 'claimed' }), await seedAgent(w.h.relay, { tier: 'claimed' })];
    const text = 'a text that will be copied by several agents';
    // w.a is at the cap, so when it becomes the third copy its hold is refused instead.
    expect(await status(await post(w.h, b, say(text)))).toBe('sent');
    expect(await status(await post(w.h, c, say(text)))).toBe('sent');
    const res = await post(w.h, w.a, say(text));
    expect(res.status).toBe(429);
    expect((await json(res)).policy_code).toBe('rate_limit');
  });

  describe('for a hold the classifier decides on', () => {
    it('refuses it at the cap, keeps it failed, and accepts the same key once there is room', async () => {
      const moderator = mod((req) => (req.content.includes('needs review') ? { verdict: 'hold', policy_code: 'sexual' } : pass));
      const w = await world({ moderator });
      await seedOwner(w.h.relay, ADMIN_DISCORD, 'admin');
      const first = (await json(await held(w.h, w.a, 'person0'))).id;
      await fill(w, 9, w.a, 1);
      const k = key();
      const refused = await post(w.h, w.a, say('This one needs review'), k);
      expect(refused.status).toBe(429);
      expect((await json(refused)).policy_code).toBe('rate_limit');
      const stored = await w.h.db
        .prepare("SELECT id, status, policy_code, status_reason FROM relay_messages WHERE content = 'This one needs review'")
        .first<Record<string, any>>();
      expect(stored).toMatchObject({ status: 'failed', policy_code: 'rate_limit' });
      expect(stored!.status_reason).toMatch(/already have 10 messages waiting/);

      // Still full: the retry is refused again and the message stays retryable.
      expect((await post(w.h, w.a, say('This one needs review'), k)).status).toBe(429);
      expect((await row(w.h, stored!.id))!.status).toBe('failed');

      await adminCall(w.h, 'POST', `/internal/admin/messages/${first}/reject`);
      const retry = await post(w.h, w.a, say('This one needs review'), k);
      expect(retry.status).toBe(202);
      expect(await json(retry)).toMatchObject({ id: stored!.id, status: 'held', policy_code: 'sexual' });
    });

    it('is not affected when the classifier passes the message', async () => {
      const w = await world();
      await fill(w);
      expect(await status(await post(w.h, w.a, say('Passes the classifier')))).toBe('sent');
    });
  });

  describe('for a hold because moderation is down', () => {
    it('counts outage holds and refuses another when the relay would hold it', async () => {
      const w = await world({ moderator: mod(down) });
      for (let i = 0; i < 10; i++)
        expect(await json(await post(w.h, w.a, say(`Waiting for moderation, number ${i}`)))).toMatchObject({ status: 'held', policy_code: 'outage' });
      const res = await post(w.h, w.a, say('One more while moderation is down'));
      expect(res.status).toBe(429);
      expect((await json(res)).policy_code).toBe('rate_limit');
      expect(await heldCount(w.h, w.a.id)).toBe(10);
      // Rule holds share the same cap.
      expect((await held(w.h, w.a, 'person0')).status).toBe(429);
    });

    it('does not cap a relay that refuses outright instead of holding', async () => {
      const w = await world({ moderator: mod(down) });
      w.h.relay.config.moderationOutage = 'refuse';
      await fill(w);
      const res = await post(w.h, w.a, say('Refused with a 503, not a 429'));
      expect(res.status).toBe(503);
      expect((await json(res)).code).toBe('moderation_unavailable');
    });
  });
});

describe('strikes come from the classifier and from admins', () => {
  const violent = (req: { content: string }) => (req.content.includes('violent') ? { verdict: 'block' as const, policy_code: 'violence' as const } : pass);

  it('adds a strike when the classifier blocks something severe', async () => {
    const w = await world({ moderator: mod(violent) });
    expect(await json(await post(w.h, w.a, say('Something violent, once')))).toMatchObject({ status: 'blocked', policy_code: 'violence' });
    expect(await activeStrikeCount(w.h.relay, w.a.id)).toBe(1);
  });

  it('adds one when the classifier is back for the re-check', async () => {
    let primaryUp = false;
    const moderator = mod(() => (primaryUp ? { verdict: 'block', policy_code: 'hate' } : down));
    const w = await world({ moderator });
    const msg = await json(await post(w.h, w.a, say('Judged later by the main classifier')));
    expect(msg.status).toBe('held');
    primaryUp = true;
    w.h.advance(61_000);
    await reviewHeldJob(w.h.relay);
    expect(await row(w.h, msg.id)).toMatchObject({ status: 'blocked', policy_code: 'hate' });
    expect(await activeStrikeCount(w.h.relay, w.a.id)).toBe(1);
  });

  it('lets admins add one for the same policy', async () => {
    const w = await world({ moderator: mod({ verdict: 'hold', policy_code: 'hate' }) });
    await seedOwner(w.h.relay, ADMIN_DISCORD, 'admin');
    const msg = await json(await post(w.h, w.a, say('Held for a person to decide')));
    await adminCall(w.h, 'POST', `/internal/admin/messages/${msg.id}/reject`, { policy_code: 'hate', strike: true });
    expect(await activeStrikeCount(w.h.relay, w.a.id)).toBe(1);
  });
});
