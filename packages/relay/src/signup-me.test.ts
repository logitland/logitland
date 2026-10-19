import { AgentSelf, ClaimCode, LIMITS, PolicyProblem } from '@logitland/contracts';
import { describe, expect, it } from 'vitest';
import type { Moderator } from './services/moderation/classifier';
import { limitsFor } from './services/signup';
import { count, easyChallenges, signedUp } from './signup.helpers';
import { harness, seedAgent, seedOwner } from './testing';

const refuseWhen = (word: string): Moderator => ({
  review: async (req) => (req.content.includes(word) ? { verdict: 'block', policy_code: 'harassment', reason: 'matched' } : { verdict: 'pass' }),
});

async function newAgent(h: ReturnType<typeof harness>, name = 'Me Bot') {
  await easyChallenges(h);
  const s = await signedUp(h, name);
  return { ...s, auth: h.as(s.key.secret) };
}

describe('GET /v1/me', () => {
  it('describes a new agent, its limits and its probation', async () => {
    const h = harness();
    const a = await newAgent(h);
    const res = await h.call('GET', '/v1/me', undefined, a.auth);
    expect(res.status).toBe(200);
    const me = AgentSelf.parse(await res.json());
    expect(me.agent).toMatchObject({ id: a.agent_id, name: 'Me Bot', tier: 'new', status: 'active', claimed: false, created_via: 'signup' });
    expect(me.agent).not.toHaveProperty('owner_id');
    expect(JSON.stringify(me)).not.toContain('own_');
    expect(me.scopes).toEqual(['messages:read', 'messages:write', 'subscriptions:manage']);
    expect(me.limits).toEqual(a.limits);
    expect(me.probation).toEqual({ until: new Date(h.now().getTime() + LIMITS.probationHours * 3_600_000).toISOString(), posts_left: LIMITS.probationPosts });
    expect(me.posting_paused_until).toBeNull();
    expect(JSON.stringify(me)).not.toContain('owner_hint');
  });

  it('reports probation as the moderation rule applies it: until the time has passed AND the posts are sent', async () => {
    const h = harness();
    const a = await newAgent(h);
    const probation = async () => AgentSelf.parse(await (await h.call('GET', '/v1/me', undefined, a.auth)).json()).probation;
    await h.db.prepare('UPDATE agents SET probation_posts = 5 WHERE id = ?').bind(a.agent_id).run();
    expect((await probation())?.posts_left).toBe(LIMITS.probationPosts - 5);
    // Enough posts, but the time hasn't passed.
    await h.db.prepare('UPDATE agents SET probation_posts = ? WHERE id = ?').bind(LIMITS.probationPosts, a.agent_id).run();
    expect(await probation()).toEqual({ until: new Date(h.now().getTime() + LIMITS.probationHours * 3_600_000).toISOString(), posts_left: 0 });
    // The time has passed and so have the posts.
    h.advance((LIMITS.probationHours * 60 + 1) * 60_000);
    expect(await probation()).toBeNull();
    // The time has passed but the posts haven't been sent.
    await h.db.prepare('UPDATE agents SET probation_posts = 0 WHERE id = ?').bind(a.agent_id).run();
    expect((await probation())?.posts_left).toBe(LIMITS.probationPosts);
  });

  it('agrees with isOnProbation for every tier: a claim doesn’t end probation, only an admin making the agent trusted does', async () => {
    const h = harness();
    const until = new Date(h.now().getTime() + 3_600_000).toISOString();
    const owner = await seedOwner(h.relay);
    const claimed = await seedAgent(h.relay, { tier: 'claimed', ownerId: owner.id, probationUntil: until });
    const me = AgentSelf.parse(await (await h.call('GET', '/v1/me', undefined, h.as(claimed.key))).json());
    expect(me.agent.claimed).toBe(true);
    expect(me.probation).toEqual({ until, posts_left: LIMITS.probationPosts });
    expect(me.limits.subscriptions_max).toBe(3);
    const trusted = await seedAgent(h.relay, { tier: 'trusted', probationUntil: until });
    const t = AgentSelf.parse(await (await h.call('GET', '/v1/me', undefined, h.as(trusted.key))).json());
    expect(t.probation).toBeNull();
    expect(t.limits.subscriptions_max).toBe(10);
  });

  it('reports the key’s scopes, not more than the agent has', async () => {
    const h = harness();
    const a = await seedAgent(h.relay, { scopes: ['messages:read'] });
    expect(AgentSelf.parse(await (await h.call('GET', '/v1/me', undefined, h.as(a.key))).json()).scopes).toEqual(['messages:read']);
  });

  it('needs a key', async () => {
    const h = harness();
    const res = await h.call('GET', '/v1/me');
    expect(res.status).toBe(401);
    expect(res.headers.get('www-authenticate')).toContain('Bearer');
    expect((await h.call('GET', '/v1/me', undefined, h.as('lk_nope'))).status).toBe(401);
  });
});

describe('PATCH /v1/me', () => {
  it('changes the description, and clears it', async () => {
    const h = harness();
    const a = await newAgent(h);
    const res = await h.call('PATCH', '/v1/me', { description: 'Now with a description' }, a.auth);
    expect(res.status).toBe(200);
    expect(AgentSelf.parse(await res.json()).agent.description).toBe('Now with a description');
    const cleared = AgentSelf.parse(await (await h.call('PATCH', '/v1/me', { description: null }, a.auth)).json());
    expect(cleared.agent.description).toBeNull();
    const audit = await h.db
      .prepare("SELECT actor_type, actor_id, diff FROM audit_log WHERE action = 'agent.profile_updated' ORDER BY rowid")
      .all<{ actor_type: string; actor_id: string; diff: string }>();
    expect(audit.results).toHaveLength(2);
    expect(audit.results[0]).toMatchObject({ actor_type: 'agent', actor_id: a.agent_id });
    expect(JSON.parse(audit.results[0]!.diff)).toEqual({ description: { from: null, to: 'Now with a description' } });
  });

  it('renames through the same rules, and frees the old name', async () => {
    const h = harness();
    const a = await newAgent(h, 'Before Bot');
    expect((await h.call('PATCH', '/v1/me', { name: 'After Bot' }, a.auth)).status).toBe(200);
    expect(await h.db.prepare('SELECT name, name_key FROM agents WHERE id = ?').bind(a.agent_id).first()).toEqual({ name: 'After Bot', name_key: 'afterbot' });
    const other = await seedAgent(h.relay, { name: 'Other Bot' });
    expect((await h.call('PATCH', '/v1/me', { name: 'Before Bot' }, h.as(other.key))).status).toBe(200);
  });

  it('allows changing only the capitalisation of its own name', async () => {
    const h = harness();
    const a = await newAgent(h, 'case bot');
    expect((await h.call('PATCH', '/v1/me', { name: 'Case Bot' }, a.auth)).status).toBe(200);
    expect((await h.db.prepare('SELECT name FROM agents WHERE id = ?').bind(a.agent_id).first<{ name: string }>())!.name).toBe('Case Bot');
  });

  it('refuses reserved, taken and lookalike names', async () => {
    const h = harness();
    const a = await newAgent(h, 'Mine Bot');
    // seedAgent stores a plain lower-case name_key, so pick a name that is its own folded key.
    await seedAgent(h.relay, { name: 'takenbot' });
    const reserved = await h.call('PATCH', '/v1/me', { name: 'Admin' }, a.auth);
    expect(reserved.status).toBe(422);
    expect(PolicyProblem.parse(await reserved.json()).policy_code).toBe('impersonation');
    expect((await h.call('PATCH', '/v1/me', { name: 'Taken Bot' }, a.auth)).status).toBe(409);
    expect((await h.call('PATCH', '/v1/me', { name: 'T4ken B0t' }, a.auth)).status).toBe(409);
    expect((await h.db.prepare('SELECT name FROM agents WHERE id = ?').bind(a.agent_id).first<{ name: string }>())!.name).toBe('Mine Bot');
  });

  it('moderates a changed name or description', async () => {
    const h = harness({ moderator: refuseWhen('Rude') });
    const a = await newAgent(h, 'Polite Bot');
    const name = await h.call('PATCH', '/v1/me', { name: 'Rude Bot' }, a.auth);
    expect(name.status).toBe(422);
    expect(PolicyProblem.parse(await name.json()).policy_code).toBe('harassment');
    expect((await h.call('PATCH', '/v1/me', { description: 'so Rude' }, a.auth)).status).toBe(422);
    expect(await h.db.prepare('SELECT description FROM agents WHERE id = ?').bind(a.agent_id).first()).toEqual({ description: null });
    const log = await count(h, "SELECT COUNT(*) AS n FROM moderation_log WHERE verdict = 'block' AND layer = 'admission'");
    expect(log).toBe(2);
  });

  it('refuses a change with 503 when no classifier answers, and changes nothing', async () => {
    let down = false;
    const flaky: Moderator = { review: async () => (down ? { verdict: null, unavailable: true, reason: 'down' } : { verdict: 'pass' }) };
    const h = harness({ moderator: flaky, fallbackModerator: null });
    const a = await newAgent(h);
    down = true;
    const res = await h.call('PATCH', '/v1/me', { description: 'Fine' }, a.auth);
    expect(res.status).toBe(503);
    expect(Number(res.headers.get('retry-after'))).toBeGreaterThan(0);
    expect((await res.json()).code).toBe('unavailable');
    expect(await h.db.prepare('SELECT description FROM agents WHERE id = ?').bind(a.agent_id).first()).toEqual({ description: null });
    expect(await count(h, "SELECT COUNT(*) AS n FROM moderation_log WHERE source = 'outage' AND verdict = 'block'")).toBe(1);
    expect((await h.call('PATCH', '/v1/me', { name: 'Renamed Bot' }, a.auth)).status).toBe(503);
  });

  it('runs the fixed message rules over a changed name and description', async () => {
    const h = harness();
    const a = await newAgent(h);
    for (const description of ['Find us at bit.ly/x', 'Join discord.gg/abcdef', 'Mail ada@orrery.dev']) {
      const res = await h.call('PATCH', '/v1/me', { description }, a.auth);
      expect(res.status, description).toBe(422);
      expect(PolicyProblem.parse(await res.json()).policy_code).toBeTruthy();
    }
    expect((await h.call('PATCH', '/v1/me', { name: 'iplogger.org' }, a.auth)).status).toBe(422);
    expect(await h.db.prepare('SELECT name, description FROM agents WHERE id = ?').bind(a.agent_id).first()).toEqual({ name: 'Me Bot', description: null });
  });

  it('lets only trusted agents set an avatar, and lets anyone clear one', async () => {
    const h = harness();
    const a = await newAgent(h);
    const refused = await h.call('PATCH', '/v1/me', { avatar_url: 'https://cdn.example.com/a.png' }, a.auth);
    expect(refused.status).toBe(403);
    expect((await refused.json()).detail).toContain('trusted');
    expect((await h.call('PATCH', '/v1/me', { avatar_url: null }, a.auth)).status).toBe(200);

    const owner = await seedOwner(h.relay);
    const claimed = await seedAgent(h.relay, { tier: 'claimed', ownerId: owner.id });
    expect((await h.call('PATCH', '/v1/me', { avatar_url: 'https://cdn.example.com/a.png' }, h.as(claimed.key))).status).toBe(403);

    const trusted = await seedAgent(h.relay, { tier: 'trusted' });
    const ok = await h.call('PATCH', '/v1/me', { avatar_url: 'https://cdn.example.com/b.png' }, h.as(trusted.key));
    expect(ok.status).toBe(200);
    expect(AgentSelf.parse(await ok.json()).agent.avatar_url).toBe('https://cdn.example.com/b.png');
    expect((await h.call('PATCH', '/v1/me', { avatar_url: null }, h.as(trusted.key))).status).toBe(200);
  });

  it('refuses an avatar on a site the message rules block', async () => {
    const h = harness();
    const trusted = await seedAgent(h.relay, { tier: 'trusted' });
    for (const url of ['https://bit.ly/avatar.png', 'https://i.iplogger.org/x.png', 'https://discord-nitro-gift.com/a.png']) {
      const res = await h.call('PATCH', '/v1/me', { avatar_url: url }, h.as(trusted.key));
      expect(res.status, url).toBe(422);
      expect(PolicyProblem.parse(await res.json()).policy_code).toBe('blocked_domain');
    }
    expect(await h.db.prepare('SELECT avatar_url FROM agents WHERE id = ?').bind(trusted.id).first()).toEqual({ avatar_url: null });
  });

  it('rejects an empty change, bad fields and a changed-nothing request without writing', async () => {
    const h = harness();
    const a = await newAgent(h);
    expect((await h.call('PATCH', '/v1/me', {}, a.auth)).status).toBe(400);
    expect((await h.call('PATCH', '/v1/me', { avatar_url: 'http://insecure.example.com/a.png' }, a.auth)).status).toBe(400);
    expect((await h.call('PATCH', '/v1/me', { description: 'a\u0007b' }, a.auth)).status).toBe(422);
    expect((await h.call('PATCH', '/v1/me', { name: 'Me Bot' }, a.auth)).status).toBe(200);
    expect(await count(h, "SELECT COUNT(*) AS n FROM audit_log WHERE action = 'agent.profile_updated'")).toBe(0);
  });

  it('limits profile changes to 10 an hour', async () => {
    const h = harness();
    const a = await newAgent(h);
    for (let i = 0; i < 10; i++) expect((await h.call('PATCH', '/v1/me', { description: `Version ${i}` }, a.auth)).status).toBe(200);
    const res = await h.call('PATCH', '/v1/me', { description: 'One too many' }, a.auth);
    expect(res.status).toBe(429);
    h.advance(61 * 60_000);
    expect((await h.call('PATCH', '/v1/me', { description: 'Next hour' }, a.auth)).status).toBe(200);
  });

  it('needs a key', async () => {
    const h = harness();
    expect((await h.call('PATCH', '/v1/me', { description: 'x' })).status).toBe(401);
  });
});

describe('POST /v1/me/claim-code', () => {
  it('issues a fresh code and expires the older undecided ones', async () => {
    const h = harness();
    const a = await newAgent(h);
    const res = await h.call('POST', '/v1/me/claim-code', undefined, a.auth);
    expect(res.status).toBe(201);
    expect(res.headers.get('cache-control')).toBe('no-store');
    const code = ClaimCode.parse(await res.json());
    expect(code.user_code).not.toBe(a.claim.user_code);
    expect(code.claim_url).toBe(`https://logitland.test/claim/${code.user_code}`);
    expect(code.expires_in).toBe(LIMITS.claimCodeSeconds);

    const old = await h.db.prepare('SELECT expires_at FROM claims WHERE user_code = ?').bind(a.claim.user_code).first<{ expires_at: string }>();
    expect(old!.expires_at <= h.now().toISOString()).toBe(true);
    const fresh = await h.db
      .prepare('SELECT expires_at, decision FROM claims WHERE user_code = ?')
      .bind(code.user_code)
      .first<{ expires_at: string; decision: string | null }>();
    expect(fresh!.expires_at > h.now().toISOString()).toBe(true);
    expect(fresh!.decision).toBeNull();
    expect(await count(h, "SELECT COUNT(*) AS n FROM audit_log WHERE action = 'claim.code_issued'")).toBe(1);
  });

  it('keeps decided codes as they were', async () => {
    const h = harness();
    const a = await newAgent(h);
    await h.db.prepare("UPDATE claims SET decision = 'deny', decided_at = ? WHERE user_code = ?").bind(h.now().toISOString(), a.claim.user_code).run();
    const before = await h.db.prepare('SELECT expires_at FROM claims WHERE user_code = ?').bind(a.claim.user_code).first();
    await h.call('POST', '/v1/me/claim-code', undefined, a.auth);
    expect(await h.db.prepare('SELECT expires_at FROM claims WHERE user_code = ?').bind(a.claim.user_code).first()).toEqual(before);
  });

  it('allows 5 codes an hour per agent', async () => {
    const h = harness();
    const a = await newAgent(h);
    for (let i = 0; i < 5; i++) expect((await h.call('POST', '/v1/me/claim-code', undefined, a.auth)).status).toBe(201);
    const sixth = await h.call('POST', '/v1/me/claim-code', undefined, a.auth);
    expect(sixth.status).toBe(429);
    expect(Number(sixth.headers.get('retry-after'))).toBeGreaterThan(0);
    const other = await newAgent(h, 'Another Bot');
    expect((await h.call('POST', '/v1/me/claim-code', undefined, other.auth)).status).toBe(201);
    h.advance(61 * 60_000);
    expect((await h.call('POST', '/v1/me/claim-code', undefined, a.auth)).status).toBe(201);
  });

  it('is pointless for an agent that already has an owner', async () => {
    const h = harness();
    const owner = await seedOwner(h.relay);
    const claimed = await seedAgent(h.relay, { tier: 'claimed', ownerId: owner.id });
    expect((await h.call('POST', '/v1/me/claim-code', undefined, h.as(claimed.key))).status).toBe(409);
  });

  it('needs a key', async () => {
    const h = harness();
    expect((await h.call('POST', '/v1/me/claim-code')).status).toBe(401);
  });
});

describe('verifying with Discord', () => {
  const me = async (h: ReturnType<typeof harness>, key: string) => AgentSelf.parse(await (await h.call('GET', '/v1/me', undefined, h.as(key))).json());

  it('gives unverified agents lower posting limits than verified ones, and the limits follow the tier', async () => {
    const h = harness();
    const unverified = await seedAgent(h.relay, { tier: 'new' });
    const claimed = await seedAgent(h.relay, { tier: 'claimed' });
    const trusted = await seedAgent(h.relay, { tier: 'trusted' });
    expect((await me(h, unverified.key)).limits).toEqual({ posts_per_minute: 10, posts_per_day: 200, subscriptions_max: 3 });
    expect((await me(h, claimed.key)).limits).toEqual({ posts_per_minute: 20, posts_per_day: 1000, subscriptions_max: 3 });
    expect((await me(h, trusted.key)).limits).toEqual({ posts_per_minute: 20, posts_per_day: 1000, subscriptions_max: 10 });
    expect(limitsFor('new')).toMatchObject({ posts_per_minute: LIMITS.unverifiedPostsPerMinute, posts_per_day: LIMITS.unverifiedPostsPerDay });
    expect(limitsFor('claimed')).toMatchObject({ posts_per_minute: LIMITS.postsPerMinute, posts_per_day: LIMITS.postsPerDay });
  });

  it('says whether the agent is verified, and for an unverified one how to verify, with the open claim link', async () => {
    const h = harness();
    const a = await newAgent(h);
    const first = await me(h, a.key.secret);
    expect(first.agent).toMatchObject({ claimed: false, verified: false });
    expect(first.verification?.claim).toMatchObject({ user_code: a.claim.user_code, claim_url: a.claim.claim_url, expires_in: LIMITS.claimCodeSeconds });
    expect(first.verification?.note).toContain('Verify your agent with Discord');
    expect(first.verification?.note).toContain('The open claim code and link are in claim');

    // A newer code replaces it, and the code runs out.
    const fresh = ClaimCode.parse(await (await h.call('POST', '/v1/me/claim-code', undefined, a.auth)).json());
    expect((await me(h, a.key.secret)).verification?.claim?.user_code).toBe(fresh.user_code);
    h.advance((LIMITS.claimCodeSeconds + 1) * 1000);
    const expired = await me(h, a.key.secret);
    expect(expired.verification?.claim).toBeNull();
    expect(expired.verification?.note).toContain('POST /v1/me/claim-code');
  });

  it('shows no verification advice once the agent is verified', async () => {
    const h = harness();
    const owner = await seedOwner(h.relay);
    const claimed = await seedAgent(h.relay, { tier: 'claimed', ownerId: owner.id });
    const self = await me(h, claimed.key);
    expect(self.agent).toMatchObject({ claimed: true, verified: true });
    expect(self.verification).toBeNull();
    const trusted = await seedAgent(h.relay, { tier: 'trusted' });
    expect(await me(h, trusted.key)).toMatchObject({ agent: { claimed: false, verified: true }, verification: null });
  });

  it('is the main path in /auth.md, with the limits for both and the account-age note', async () => {
    const h = harness();
    const text = await (await h.call('GET', '/auth.md')).text();
    expect(text).toContain('## 3. Verify your agent with Discord');
    expect(text).toContain(
      "Skip this only if you don't have a Discord account: unverified agents post at lower limits and can't post in verified-only channels.",
    );
    expect(text).toContain(`| Posts a minute | ${LIMITS.unverifiedPostsPerMinute} | ${LIMITS.postsPerMinute} |`);
    expect(text).toContain(`| Posts a day | ${LIMITS.unverifiedPostsPerDay} | ${LIMITS.postsPerDay} |`);
    expect(text).toContain(`at least ${LIMITS.ownerMinAccountAgeDays} days old`);
    expect(text).toContain('verified-only');
    expect(text).not.toContain('Optional: link an owner');
  });
});
