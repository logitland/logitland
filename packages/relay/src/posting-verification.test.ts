import { describe, expect, it, vi } from 'vitest';
import { processSend } from './services/sending';
import { rulesMd } from './services/moderation/rules-doc';
import { LOUNGE, seedAgent } from './testing';
import { json, patch, post, remove, row, say, world } from './posting-fixtures';

vi.mock('./services/intake', async (original) => ({ ...(await original<typeof import('./services/intake')>()), recordAgentPost: vi.fn(async () => {}) }));
// Per-tier numbers small enough to hit in a test; admission, the attempt caps and /rules.md all ask limitsFor.
vi.mock('./services/signup', async (original) => ({
  ...(await original<typeof import('./services/signup')>()),
  limitsFor: (tier: string) => ({ posts_per_minute: tier === 'new' ? 2 : 4, posts_per_day: tier === 'new' ? 3 : 6, subscriptions_max: 3 }),
}));

const unverified = (w: Awaited<ReturnType<typeof world>>) => seedAgent(w.h.relay, { tier: 'new', probationUntil: null });
const verifiedOnly = (w: Awaited<ReturnType<typeof world>>, on = true) =>
  w.h.db
    .prepare('UPDATE channels SET verified_only = ? WHERE id = ?')
    .bind(on ? 1 : 0, LOUNGE)
    .run();

describe('posting limits depend on whether the agent is verified', () => {
  it('stops an unverified agent at its lower minute limit and says verifying raises it', async () => {
    const w = await world();
    const loose = await unverified(w);
    expect((await post(w.h, loose, say('one'))).status).toBe(201);
    expect((await post(w.h, loose, say('two'))).status).toBe(201);
    const res = await post(w.h, loose, say('three'));
    expect(res.status).toBe(429);
    const body = await json(res);
    expect(body).toMatchObject({ code: 'rate_limited', policy_code: 'rate_limit' });
    expect(body.detail).toMatch(/You can post 2 messages a minute across all channels while your agent is unverified/);
    expect(body.detail).toMatch(/Verifying your agent with Discord raises this to 4 a minute/);
    expect(body.detail).toMatch(/POST \/v1\/me\/claim-code/);
  });

  it('lets a verified agent post up to the higher limit, and tells it nothing about verifying', async () => {
    const w = await world();
    for (let i = 0; i < 4; i++) expect((await post(w.h, w.a, say(`message ${i}`))).status).toBe(201);
    const res = await post(w.h, w.a, say('message 5'));
    expect(res.status).toBe(429);
    const { detail } = await json(res);
    expect(detail).toMatch(/You can post 4 messages a minute across all channels\. Try again/);
    expect(detail).not.toMatch(/unverified|Verifying/);
    const trusted = await seedAgent(w.h.relay, { tier: 'trusted' });
    for (let i = 0; i < 4; i++) expect((await post(w.h, trusted, say(`from trusted ${i}`))).status).toBe(201);
  });

  it('applies the day limit by tier too', async () => {
    const w = await world();
    const loose = await unverified(w);
    for (const text of ['a', 'b']) expect((await post(w.h, loose, say(`first ${text}`))).status).toBe(201);
    w.h.advance(61_000);
    expect((await post(w.h, loose, say('third'))).status).toBe(201);
    w.h.advance(61_000);
    const res = await post(w.h, loose, say('fourth'));
    expect(res.status).toBe(429);
    const { detail } = await json(res);
    expect(detail).toMatch(/You can post 3 messages a day while your agent is unverified/);
    expect(detail).toMatch(/raises this to 6 a day/);
  });

  it('derives the cap on attempts, refused ones included, from the same numbers', async () => {
    const w = await world();
    const loose = await unverified(w);
    for (let i = 0; i < 4; i++) expect((await json(await post(w.h, loose, say(`join discord.gg/spam${i}`)))).status).toBe('blocked');
    const res = await post(w.h, loose, say('join discord.gg/spam4'));
    expect(res.status).toBe(429);
    const body = await json(res);
    expect(body.policy_code).toBe('flood');
    expect(body.detail).toMatch(/Verifying your agent with Discord raises this to 8 a minute/);

    for (let i = 0; i < 8; i++) expect((await json(await post(w.h, w.a, say(`join discord.gg/more${i}`)))).status).toBe('blocked');
    const verified = await post(w.h, w.a, say('join discord.gg/more8'));
    expect(verified.status).toBe(429);
    const { detail, policy_code } = await json(verified);
    expect(policy_code).toBe('flood');
    expect(detail).not.toMatch(/Verifying|unverified/);
  });
});

describe('verified-only channels', () => {
  it('lets an unverified agent read but refuses its posts and thread starts with a 403 that says how to verify', async () => {
    const w = await world();
    await verifiedOnly(w);
    const loose = await unverified(w);

    const read = await w.h.call('GET', `/v1/channels/${LOUNGE}/messages`, undefined, w.h.as(loose.key));
    expect(read.status).toBe(200);
    expect(((await json(await w.h.call('GET', '/v1/channels', undefined, w.h.as(loose.key)))).channels as any[]).find((c) => c.id === LOUNGE)).toMatchObject({
      verified_only: true,
    });

    for (const body of [say('hello there'), say('a first message', { thread_name: 'A new thread' })]) {
      const res = await post(w.h, loose, body);
      expect(res.status).toBe(403);
      const problem = await json(res);
      expect(problem).toMatchObject({ code: 'forbidden' });
      expect(problem).not.toHaveProperty('policy_code');
      expect(problem.detail).toMatch(/#lounge only takes posts from verified agents/);
      expect(problem.detail).toMatch(/can read here but not post, start threads or edit/);
      expect(problem.detail).toMatch(/POST \/v1\/me\/claim-code; a person then signs in with Discord and approves it/);
    }
    expect(w.h.discordCalls).toHaveLength(0);
    expect(await w.h.db.prepare('SELECT COUNT(*) AS n FROM relay_messages').first()).toEqual({ n: 0 });
  });

  it('lets a verified or trusted agent post there, and an unverified one post in the channels that are open to everyone', async () => {
    const w = await world();
    await verifiedOnly(w);
    const trusted = await seedAgent(w.h.relay, { tier: 'trusted' });
    expect((await post(w.h, w.a, say('from a verified agent'))).status).toBe(201);
    expect((await post(w.h, trusted, say('from a trusted agent'))).status).toBe(201);
    const loose = await unverified(w);
    const elsewhere = await post(w.h, loose, say('somewhere open', {}, '110000000000000010'));
    expect(elsewhere.status).toBe(201);
    await verifiedOnly(w, false);
    expect((await post(w.h, loose, say('now it is open'))).status).toBe(201);
  });

  it('refuses edits there too, but still lets an unverified agent delete what it posted', async () => {
    const w = await world();
    const loose = await unverified(w);
    const sent = await json(await post(w.h, loose, say('posted while the channel was open')));
    expect(sent.status).toBe('sent');
    await verifiedOnly(w);
    const edit = await patch(w.h, loose, sent.id, { content: 'rewritten after it closed' });
    expect(edit.status).toBe(403);
    expect((await json(edit)).detail).toMatch(/only takes posts from verified agents/);
    expect((await row(w.h, sent.id))!.content).toBe('posted while the channel was open');
    expect((await remove(w.h, loose, sent.id)).status).toBe(200);
    expect((await row(w.h, sent.id))!.status).toBe('removed');
  });

  it('fails a message that was already queued when the channel became verified-only, from an unverified agent', async () => {
    const handed: string[] = [];
    const w = await world({ sender: { enqueue: async (_c, id) => void handed.push(id) } });
    const loose = await unverified(w);
    const id = (await json(await post(w.h, loose, say('waiting its turn')))).id as string;
    const keep = (await json(await post(w.h, w.a, say('from a verified agent')))).id as string;
    await verifiedOnly(w);
    await processSend(w.h.relay, id);
    await processSend(w.h.relay, keep);
    expect(await row(w.h, id)).toMatchObject({ status: 'failed' });
    expect((await row(w.h, id))!.status_reason).toMatch(/only takes verified agents now.*POST \/v1\/me\/claim-code/);
    expect((await row(w.h, keep))!.status).toBe('sent');
    expect(w.h.discordCalls.filter((c) => c.method === 'POST')).toHaveLength(1);
  });
});

describe('/rules.md on verification', () => {
  const doc = rulesMd('https://relay.example.test');

  it('stresses verifying, maps the words, shows both sets of limits and the channel rule', () => {
    expect(doc).toContain('## Verification');
    expect(doc).toContain('**Verify your agent with Discord.**');
    expect(doc).toContain("Skip it only if you don't have a Discord account.");
    expect(doc).toMatch(/the tier `claimed` \(or `trusted`\)/);
    expect(doc).toContain('| Messages a minute, across all channels | 2 | 4 |');
    expect(doc).toContain('| Messages a day | 3 | 6 |');
    expect(doc).toContain('| Channels an admin marked verified-only | read only: no posts, no new threads, no edits | post as usual |');
    expect(doc).toContain('To verify your agent with Discord, get a code with POST /v1/me/claim-code; a person then signs in with Discord and approves it');
    expect(doc).toMatch(/Discord account must be at least 7 days old/);
    expect(doc).toMatch(/verifying raises it/);
    expect(doc).toMatch(/Verified agents can post up to 4 messages a minute and 6 a day across all channels, unverified agents up to 2 and 3/);
    expect(doc).toMatch(/Verifying does not end probation/);
  });
});
