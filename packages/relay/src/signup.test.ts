import { LIMITS, PolicyProblem, SignupChallenge, SignupResponse } from '@logitland/contracts';
import { describe, expect, it } from 'vitest';
import { sha256 } from './crypto';
import { clientHashes, recordOrigin } from './services/origins';
import { consumeChallenge, issueChallenge, leadingZeroBits } from './services/pow';
import { hit } from './services/limits';
import { updateSettings } from './services/settings';
import { signup } from './services/signup';
import type { Moderator } from './services/moderation/classifier';
import { count, easyChallenges, getChallenge, ipHeader, signUp, signedUp, solve } from './signup.helpers';
import { harness, seedAgent } from './testing';

const verdict = (v: 'pass' | 'hold' | 'block', policy_code?: 'harassment' | 'spam', reason = 'test'): Moderator => ({
  review: async () => ({ verdict: v, policy_code, reason }),
});
const unavailable: Moderator = { review: async () => ({ verdict: null, unavailable: true, reason: 'down' }) };
const refuseWhen = (word: string, code: 'harassment' | 'spam'): Moderator => ({
  review: async (req) => (req.content.includes(word) ? { verdict: 'block', policy_code: code, reason: 'matched' } : { verdict: 'pass' }),
});

describe('proof of work', () => {
  it('issues a challenge that lives five minutes at the configured difficulty', async () => {
    const h = harness();
    const res = await h.call('GET', '/v1/signup/challenge');
    expect(res.status).toBe(200);
    const c = SignupChallenge.parse(await res.json());
    expect(c.algorithm).toBe('sha256-leading-zero-bits');
    expect(c.difficulty).toBe(LIMITS.powDifficulty);
    expect(c.challenge).toMatch(/^pow_/);
    expect(new Date(c.expires_at).getTime() - h.now().getTime()).toBe(LIMITS.powTtlSeconds * 1000);
    const row = await h.db
      .prepare('SELECT difficulty, used_at, net_hmac FROM pow_challenges WHERE id = ?')
      .bind(c.challenge)
      .first<{ difficulty: number; used_at: string | null; net_hmac: string }>();
    expect(row).toMatchObject({ difficulty: LIMITS.powDifficulty, used_at: null });
    expect(row!.net_hmac).toMatch(/^[0-9a-f]{64}$/);
    expect(res.headers.get('cache-control')).toBe('no-store');
  });

  it('follows the difficulty setting', async () => {
    const h = harness();
    await easyChallenges(h);
    expect((await getChallenge(h)).difficulty).toBe(8);
  });

  it('adds a bit for each signup beyond two from the network in the last hour, up to the cap', async () => {
    const h = harness();
    await easyChallenges(h);
    const ips = ['203.0.113.7', '203.0.113.8', '203.0.113.9', '203.0.113.10'];
    const seen: number[] = [];
    for (const ip of ips) {
      seen.push((await getChallenge(h, ipHeader(ip))).difficulty);
      await signedUp(h, `Agent ${ip}`, { headers: ipHeader(ip) });
    }
    expect(seen).toEqual([8, 8, 8, 9]);
    expect((await getChallenge(h, ipHeader('203.0.113.11'))).difficulty).toBe(10);
    expect((await getChallenge(h, ipHeader('198.51.100.1'))).difficulty).toBe(8);
    h.advance(61 * 60_000);
    expect((await getChallenge(h)).difficulty).toBe(8);
  });

  it('never rises above the maximum', async () => {
    const h = harness();
    await updateSettings(h.relay, 'own_test_setup', { pow_difficulty: 25 });
    for (let i = 0; i < 6; i++)
      await recordOrigin(
        h.relay,
        (await seedAgent(h.relay, { tier: 'new' })).id,
        { ip: `203.0.113.${20 + i}`, asn: null, asOrganization: null, country: null },
        'signup',
      );
    expect((await getChallenge(h)).difficulty).toBe(LIMITS.powMaxDifficulty);
  });

  it('limits how many challenges a network can ask for', async () => {
    const h = harness();
    for (let i = 0; i < 60; i++) expect((await h.call('GET', '/v1/signup/challenge')).status).toBe(200);
    const res = await h.call('GET', '/v1/signup/challenge');
    expect(res.status).toBe(429);
    expect(Number(res.headers.get('retry-after'))).toBeGreaterThan(0);
    expect((await h.call('GET', '/v1/signup/challenge', undefined, ipHeader('198.51.100.5'))).status).toBe(200);
  });

  it('counts leading zero bits', () => {
    expect(leadingZeroBits('ff')).toBe(0);
    expect(leadingZeroBits('7f')).toBe(1);
    expect(leadingZeroBits('0f')).toBe(4);
    expect(leadingZeroBits('0001')).toBe(15);
    expect(leadingZeroBits('00')).toBe(8);
  });

  it('works once: a used challenge is refused', async () => {
    const h = harness();
    await easyChallenges(h);
    const c = await getChallenge(h);
    const nonce = solve(c.challenge, c.difficulty);
    const first = await h.call('POST', '/v1/agents', { name: 'Once', challenge: c.challenge, nonce });
    expect(first.status).toBe(201);
    const again = await h.call('POST', '/v1/agents', { name: 'Twice', challenge: c.challenge, nonce });
    expect(again.status).toBe(409);
    expect(await count(h, 'SELECT COUNT(*) AS n FROM agents')).toBe(1);
  });

  it('lets only one of two simultaneous signups use the same challenge', async () => {
    const h = harness();
    await easyChallenges(h);
    const c = await getChallenge(h);
    const nonce = solve(c.challenge, c.difficulty);
    const post = (name: string, ip: string) => h.call('POST', '/v1/agents', { name, challenge: c.challenge, nonce }, ipHeader(ip));
    const statuses = (await Promise.all([post('Racer One', '203.0.113.20'), post('Racer Two', '203.0.113.21')])).map((r) => r.status).sort();
    expect(statuses).toEqual([201, 409]);
  });

  it('refuses unknown challenges, wrong nonces and expired challenges', async () => {
    const h = harness();
    await easyChallenges(h);
    const unknown = await h.call('POST', '/v1/agents', { name: 'Nobody', challenge: 'pow_NOPE', nonce: '1' });
    expect(unknown.status).toBe(400);

    const c = await getChallenge(h);
    let wrong = 0;
    while (leadingZeroBits(await sha256(`${c.challenge}:${wrong}`)) >= c.difficulty) wrong++;
    const bad = await h.call('POST', '/v1/agents', { name: 'Nonce', challenge: c.challenge, nonce: String(wrong) });
    expect(bad.status).toBe(400);
    expect((await bad.json()).detail).toContain(`${c.difficulty} zero bits`);
    // A wrong answer doesn't spend the challenge.
    expect((await h.call('POST', '/v1/agents', { name: 'Nonce', challenge: c.challenge, nonce: solve(c.challenge, c.difficulty) })).status).toBe(201);

    const old = await getChallenge(h, ipHeader('198.51.100.3'));
    h.advance(LIMITS.powTtlSeconds * 1000 + 1000);
    const expired = await h.call(
      'POST',
      '/v1/agents',
      { name: 'Late', challenge: old.challenge, nonce: solve(old.challenge, old.difficulty) },
      ipHeader('198.51.100.3'),
    );
    expect(expired.status).toBe(410);
    expect((await expired.json()).code).toBe('expired');
  });

  it('only works from the network it was issued to, and is not spent by a refusal from another', async () => {
    const h = harness();
    await easyChallenges(h);
    const c = await getChallenge(h);
    const nonce = solve(c.challenge, c.difficulty);
    const elsewhere = await h.call('POST', '/v1/agents', { name: 'Borrowed', challenge: c.challenge, nonce }, ipHeader('198.51.100.9'));
    expect(elsewhere.status).toBe(403);
    expect((await elsewhere.json()).detail).toContain('different network');
    expect(await h.db.prepare('SELECT used_at FROM pow_challenges WHERE id = ?').bind(c.challenge).first()).toEqual({ used_at: null });
    // Another address in the same /24 is the same network.
    expect((await h.call('POST', '/v1/agents', { name: 'Borrowed', challenge: c.challenge, nonce }, ipHeader('203.0.113.200'))).status).toBe(201);
  });

  it('refuses to spend a challenge for another network even when the first check is skipped', async () => {
    const h = harness();
    await easyChallenges(h);
    const c = await getChallenge(h);
    const other = await clientHashes(h.relay, { ip: '198.51.100.9', asn: null, asOrganization: null, country: null });
    await expect(consumeChallenge(h.relay, c.challenge, other.net)).rejects.toMatchObject({ status: 403 });
    const own = await clientHashes(h.relay, { ip: '203.0.113.7', asn: null, asOrganization: null, country: null });
    await consumeChallenge(h.relay, c.challenge, own.net);
    await expect(consumeChallenge(h.relay, c.challenge, own.net)).rejects.toMatchObject({ status: 409 });
  });
});

describe('signing up', () => {
  it('creates an agent and its key with no Discord account involved', async () => {
    const h = harness();
    await easyChallenges(h);
    const res = await signUp(h, 'Orrery Bot', { description: 'Tracks the planets', owner_hint: 'Ada at orrery.dev' });
    expect(res.status).toBe(201);
    expect(res.headers.get('cache-control')).toBe('no-store');
    const body = SignupResponse.parse(await res.json());
    expect(body.tier).toBe('new');
    expect(body.key.secret).toMatch(/^lk_/);
    expect(body.key.scopes).toEqual(['messages:read', 'messages:write', 'subscriptions:manage']);
    // Unverified: it hasn't been claimed yet, so it posts less often than a verified agent.
    expect(body.limits).toEqual({ posts_per_minute: LIMITS.unverifiedPostsPerMinute, posts_per_day: LIMITS.unverifiedPostsPerDay, subscriptions_max: 3 });
    expect(LIMITS.unverifiedPostsPerMinute).toBeLessThan(LIMITS.postsPerMinute);
    expect(body.claim.note).toContain('Verify your agent with Discord');
    expect(body.claim.note).toContain('only if you don’t have a Discord account');
    expect(body.claim.note).toContain(`${LIMITS.unverifiedPostsPerMinute} a minute and ${LIMITS.unverifiedPostsPerDay} a day`);
    expect(body.claim.note).toContain('verified-only channels');
    expect(body.claim.claim_url).toBe(`https://logitland.test/claim/${body.claim.user_code}`);
    expect(body.claim.expires_in).toBe(LIMITS.claimCodeSeconds);

    const agent = await h.db.prepare('SELECT * FROM agents WHERE id = ?').bind(body.agent_id).first<Record<string, unknown>>();
    expect(agent).toMatchObject({
      owner_id: null,
      name: 'Orrery Bot',
      name_key: 'orrerybot',
      description: 'Tracks the planets',
      tier: 'new',
      status: 'active',
      created_via: 'signup',
      owner_hint: 'Ada at orrery.dev',
      probation_posts: 0,
    });
    expect(agent!.probation_until).toBe(new Date(h.now().getTime() + LIMITS.probationHours * 3_600_000).toISOString());
    expect(JSON.parse(agent!.scopes as string)).toEqual(body.key.scopes);

    const key = await h.db.prepare('SELECT * FROM api_keys WHERE agent_id = ?').bind(body.agent_id).first<Record<string, unknown>>();
    expect(key).toMatchObject({ id: body.key.id, label: 'signup', hash: await sha256(body.key.secret), revoked_at: null, expires_at: null });
    expect(key!.hash).not.toBe(body.key.secret);
    expect(await h.db.prepare('SELECT * FROM claims WHERE user_code = ?').bind(body.claim.user_code).first()).toMatchObject({
      agent_id: body.agent_id,
      decision: null,
    });
    expect(await h.db.prepare("SELECT * FROM audit_log WHERE action = 'agent.signed_up'").first()).toMatchObject({
      actor_type: 'agent',
      actor_id: body.agent_id,
      target_id: body.agent_id,
    });
    expect(h.discordCalls).toHaveLength(0);

    const me = await h.call('GET', '/v1/me', undefined, h.as(body.key.secret));
    expect(me.status).toBe(200);
  });

  it('records where the agent signed up from', async () => {
    const h = harness();
    await easyChallenges(h);
    const body = await signedUp(h, 'Origin Bot');
    const origin = await h.db.prepare('SELECT * FROM agent_origins WHERE agent_id = ?').bind(body.agent_id).first<Record<string, unknown>>();
    expect(origin).toMatchObject({ kind: 'signup' });
    expect(origin!.ip_hmac).toMatch(/^[0-9a-f]{64}$/);
    expect(origin!.ip_sealed).toBeTruthy();
    expect(JSON.stringify(origin)).not.toContain('203.0.113.7');
  });

  it('leaves the description and owner hint empty when not given', async () => {
    const h = harness();
    await easyChallenges(h);
    const body = await signedUp(h, 'Plain Bot');
    expect(await h.db.prepare('SELECT description, owner_hint FROM agents WHERE id = ?').bind(body.agent_id).first()).toEqual({
      description: null,
      owner_hint: null,
    });
  });

  it('is refused with 403 while signups are closed, and no challenge is issued', async () => {
    const h = harness();
    await easyChallenges(h);
    const c = await getChallenge(h);
    await updateSettings(h.relay, 'own_test_setup', { signup_open: false });
    const res = await h.call('POST', '/v1/agents', { name: 'Closed', challenge: c.challenge, nonce: solve(c.challenge, c.difficulty) });
    expect(res.status).toBe(403);
    expect((await h.call('GET', '/v1/signup/challenge')).status).toBe(403);
    expect(await count(h, 'SELECT COUNT(*) AS n FROM agents')).toBe(0);
    await updateSettings(h.relay, 'own_test_setup', { signup_open: true });
    expect((await signUp(h, 'Reopened')).status).toBe(201);
  });

  it('rejects malformed requests', async () => {
    const h = harness();
    expect((await h.call('POST', '/v1/agents', { name: 'x' })).status).toBe(400);
    expect((await h.call('POST', '/v1/agents', { name: 'Fine', challenge: 'nope', nonce: '1' })).status).toBe(400);
  });
});

describe('signup limits', () => {
  it('allows 3 signups an hour from one address', async () => {
    const h = harness();
    await easyChallenges(h);
    for (const n of [1, 2, 3]) expect((await signUp(h, `Same Ip ${n}`)).status).toBe(201);
    const fourth = await signUp(h, 'Same Ip 4');
    expect(fourth.status).toBe(429);
    expect(Number(fourth.headers.get('retry-after'))).toBeGreaterThan(0);
    expect((await signUp(h, 'Other Ip', { headers: ipHeader('203.0.113.99') })).status).toBe(201);
    h.advance(61 * 60_000);
    expect((await signUp(h, 'Same Ip 5')).status).toBe(201);
  });

  it('allows 5 signups an hour from one network, whichever addresses they use', async () => {
    const h = harness();
    await easyChallenges(h);
    const statuses: number[] = [];
    for (const ip of ['203.0.113.1', '203.0.113.1', '203.0.113.2', '203.0.113.2', '203.0.113.3', '203.0.113.4']) {
      statuses.push((await signUp(h, `Net ${statuses.length}`, { headers: ipHeader(ip) })).status);
    }
    expect(statuses).toEqual([201, 201, 201, 201, 201, 429]);
    expect((await signUp(h, 'Elsewhere', { headers: ipHeader('203.0.114.1') })).status).toBe(201);
  });

  it('treats every address in an IPv6 /64 as one address', async () => {
    const h = harness();
    await easyChallenges(h);
    const statuses: number[] = [];
    for (let i = 1; i <= 5; i++) statuses.push((await signUp(h, `Six ${i}`, { headers: ipHeader(`2001:db8:1:2::${i}`) })).status);
    expect(statuses).toEqual([201, 201, 201, 429, 429]);
    expect((await signUp(h, 'Next door', { headers: ipHeader('2001:db8:1:3::1') })).status).toBe(201);
  });

  it('treats every /64 in an IPv6 /48 as one network', async () => {
    const h = harness();
    await easyChallenges(h);
    const statuses: number[] = [];
    for (let i = 1; i <= 6; i++) statuses.push((await signUp(h, `Broker ${i}`, { headers: ipHeader(`2001:db8:7:${i}::1`) })).status);
    expect(statuses).toEqual([201, 201, 201, 201, 201, 429]);
    expect((await signUp(h, 'Other prefix', { headers: ipHeader('2001:db8:8::1') })).status).toBe(201);
  });

  it('allows 30 signups an hour from one provider, however many networks it has', async () => {
    const h = harness();
    await easyChallenges(h);
    const signAs = async (name: string, ip: string, asn: number | null) => {
      const client = { ip, asn, asOrganization: null, country: null };
      const c = await issueChallenge(h.relay, client);
      return signup(h.relay, { name, challenge: c.challenge, nonce: solve(c.challenge, c.difficulty) }, client).then(
        () => 201,
        (e: { status: number }) => e.status,
      );
    };
    const statuses: number[] = [];
    for (let i = 0; i <= LIMITS.signupsPerAsnPerHour; i++) statuses.push(await signAs(`Provider ${i}`, `198.51.${100 + i}.1`, 64500));
    expect(statuses.filter((s) => s === 201)).toHaveLength(LIMITS.signupsPerAsnPerHour);
    expect(statuses.at(-1)).toBe(429);
    expect(await signAs('Other provider', '192.0.2.77', 64501)).toBe(201);
    expect(await signAs('No provider known', '192.0.2.78', null)).toBe(201);
  });

  it('stops all signups for the hour once the relay-wide cap is reached', async () => {
    const h = harness();
    await easyChallenges(h);
    for (let i = 0; i < LIMITS.signupsPerHour; i++) await hit(h.relay, { key: 'signup:all:h', limit: LIMITS.signupsPerHour, windowSeconds: 3600 });
    const res = await signUp(h, 'Too Late', { headers: ipHeader('198.51.100.40') });
    expect(res.status).toBe(429);
    expect(await count(h, 'SELECT COUNT(*) AS n FROM agents')).toBe(0);
    h.advance(61 * 60_000);
    expect((await signUp(h, 'On Time', { headers: ipHeader('198.51.100.40') })).status).toBe(201);
  });

  it('allows 20 signups a day from one network', async () => {
    const h = harness();
    await easyChallenges(h);
    let made = 0;
    for (let hour = 0; hour < 4; hour++) {
      for (const ip of ['203.0.113.1', '203.0.113.1', '203.0.113.1', '203.0.113.2', '203.0.113.2']) {
        expect((await signUp(h, `Day ${made++}`, { headers: ipHeader(ip) })).status).toBe(201);
      }
      h.advance(61 * 60_000);
    }
    const twentyFirst = await signUp(h, 'Day 20', { headers: ipHeader('203.0.113.3') });
    expect(twentyFirst.status).toBe(429);
    expect(made).toBe(20);
  });

  it('keeps the challenge when a limit refuses the signup', async () => {
    const h = harness();
    await easyChallenges(h);
    for (const n of [1, 2, 3]) await signedUp(h, `Fill ${n}`);
    const c = await getChallenge(h);
    const nonce = solve(c.challenge, c.difficulty);
    expect((await h.call('POST', '/v1/agents', { name: 'Blocked', challenge: c.challenge, nonce })).status).toBe(429);
    expect(await h.db.prepare('SELECT used_at FROM pow_challenges WHERE id = ?').bind(c.challenge).first()).toEqual({ used_at: null });
    expect((await h.call('POST', '/v1/agents', { name: 'Blocked', challenge: c.challenge, nonce }, ipHeader('203.0.113.50'))).status).toBe(201);
  });
});

describe('signup names', () => {
  it('refuses a reserved name with 422, the policy code and a reason, and keeps the challenge', async () => {
    const h = harness();
    await easyChallenges(h);
    const c = await getChallenge(h);
    const nonce = solve(c.challenge, c.difficulty);
    const res = await h.call('POST', '/v1/agents', { name: 'Admin', challenge: c.challenge, nonce });
    expect(res.status).toBe(422);
    expect(res.headers.get('content-type')).toContain('application/problem+json');
    const problem = PolicyProblem.parse(await res.json());
    expect(problem.policy_code).toBe('impersonation');
    expect(problem.detail).toContain('admin');
    const retry = await h.call('POST', '/v1/agents', { name: 'Adamant', challenge: c.challenge, nonce });
    expect(retry.status).toBe(201);
  });

  it.each([
    ['Adm1n', 'impersonation'],
    ['Logitland Support', 'impersonation'],
    ['0fficial Staff', 'impersonation'],
    ['m.o.d', 'impersonation'],
    ['Server Mod', 'impersonation'],
    ['Bad$Name', 'name_policy'],
    ['Emoji 🙂 Bot', 'name_policy'],
    ['Zero\u200bWidth', 'name_policy'],
    ['Bidi\u202eName', 'name_policy'],
    ['--', 'name_policy'],
  ])('refuses %j as %s', async (name, code) => {
    const h = harness();
    await easyChallenges(h);
    const res = await signUp(h, name);
    expect(res.status).toBe(422);
    expect(PolicyProblem.parse(await res.json()).policy_code).toBe(code);
    expect(await count(h, 'SELECT COUNT(*) AS n FROM agents')).toBe(0);
  });

  it('refuses names outside 2 to 32 characters while validating the request', async () => {
    const h = harness();
    await easyChallenges(h);
    for (const name of ['x', 'a b c d e f g h i j k l m n o p q r s t u v w x y z']) {
      const res = await signUp(h, name);
      expect(res.status).toBe(400);
      expect((await res.json()).errors[0].path).toBe('name');
    }
  });

  it('accepts ordinary names that merely contain a short reserved word', async () => {
    const h = harness();
    await easyChallenges(h);
    for (const [i, name] of ['Model Maker', 'Somewhere', 'Modern Bot', "Léa O'Neil", 'Ada-2'].entries()) {
      expect((await signUp(h, name, { headers: ipHeader(`198.51.100.${i + 1}`) })).status).toBe(201);
    }
  });

  it('answers 409 when the name is taken, including by a lookalike, and keeps the challenge', async () => {
    const h = harness();
    await easyChallenges(h);
    await signedUp(h, 'Logan Bot');
    const c = await getChallenge(h, ipHeader('198.51.100.1'));
    const nonce = solve(c.challenge, c.difficulty);
    for (const name of ['Logan Bot', 'logan-bot', 'L0gan B0t', 'Lоgan Bоt']) {
      const res = await h.call('POST', '/v1/agents', { name, challenge: c.challenge, nonce }, ipHeader('198.51.100.1'));
      expect(res.status).toBe(409);
      expect((await res.json()).detail).toContain('That name is taken');
    }
    expect((await h.call('POST', '/v1/agents', { name: 'Logan Two', challenge: c.challenge, nonce }, ipHeader('198.51.100.1'))).status).toBe(201);
  });

  it('stores the plain-letter form of a fancy-font name', async () => {
    const h = harness();
    await easyChallenges(h);
    const body = await signedUp(h, '𝐁𝐨𝐥𝐝 𝐁𝐨𝐭');
    expect((await h.db.prepare('SELECT name FROM agents WHERE id = ?').bind(body.agent_id).first<{ name: string }>())!.name).toBe('Bold Bot');
  });
});

describe('signup moderation', () => {
  it('logs a pass for the name and the description', async () => {
    const h = harness();
    await easyChallenges(h);
    await signedUp(h, 'Clean Bot', { description: 'Says hello' });
    const { results } = await h.db.prepare('SELECT * FROM moderation_log ORDER BY id').all<Record<string, unknown>>();
    expect(results).toHaveLength(2);
    expect(results[0]).toMatchObject({ layer: 'admission', verdict: 'pass', policy_code: null, source: 'jev_laya', reason: 'name' });
    expect(results[1]).toMatchObject({ layer: 'admission', verdict: 'pass', reason: 'description' });
    expect(results[0]!.agent_id).toBe(results[1]!.agent_id);
  });

  it('refuses a blocked name with 422 and the classifier’s policy code', async () => {
    const h = harness({ moderator: refuseWhen('Slur', 'harassment') });
    await easyChallenges(h);
    const res = await signUp(h, 'Slurbot');
    expect(res.status).toBe(422);
    const problem = PolicyProblem.parse(await res.json());
    expect(problem.policy_code).toBe('harassment');
    expect(problem.detail).toContain('Pick a different name');
    expect(problem.detail).toContain('wasn’t saved');
    expect(await count(h, 'SELECT COUNT(*) AS n FROM agents')).toBe(0);
    expect(await h.db.prepare('SELECT layer, verdict, policy_code, source FROM moderation_log').first()).toEqual({
      layer: 'admission',
      verdict: 'block',
      policy_code: 'harassment',
      source: 'jev_laya',
    });
  });

  it('refuses a held description, defaulting the policy code', async () => {
    const h = harness({ moderator: { review: async (req) => (req.kind === 'description' ? { verdict: 'hold' } : { verdict: 'pass' }) } });
    await easyChallenges(h);
    const res = await signUp(h, 'Held Bot', { description: 'anything' });
    expect(res.status).toBe(422);
    expect(PolicyProblem.parse(await res.json()).policy_code).toBe('other');
    const { results } = await h.db.prepare('SELECT verdict, policy_code FROM moderation_log ORDER BY id').all();
    expect(results).toEqual([
      { verdict: 'pass', policy_code: null },
      { verdict: 'hold', policy_code: 'other' },
    ]);
  });

  it('defaults a blocked name without a code to name_policy', async () => {
    const h = harness({ moderator: verdict('block') });
    await easyChallenges(h);
    expect(PolicyProblem.parse(await (await signUp(h, 'No Code')).json()).policy_code).toBe('name_policy');
  });

  it('spends the challenge when moderation refuses', async () => {
    const h = harness({ moderator: verdict('block', 'spam') });
    await easyChallenges(h);
    const c = await getChallenge(h);
    const nonce = solve(c.challenge, c.difficulty);
    const first = await h.call('POST', '/v1/agents', { name: 'Spammy', challenge: c.challenge, nonce });
    expect(first.status).toBe(422);
    expect((await first.json()).detail).toContain('get a new one');
    expect((await h.call('POST', '/v1/agents', { name: 'Other', challenge: c.challenge, nonce })).status).toBe(409);
  });

  it('falls back to the second classifier when the first is unavailable', async () => {
    const h = harness({ moderator: unavailable, fallbackModerator: refuseWhen('Mean', 'harassment') });
    await easyChallenges(h);
    expect((await signUp(h, 'Kind Bot')).status).toBe(201);
    const res = await signUp(h, 'Mean Bot', { headers: ipHeader('198.51.100.1') });
    expect(res.status).toBe(422);
    const { results } = await h.db.prepare('SELECT source, verdict FROM moderation_log ORDER BY id').all();
    expect(results).toEqual([
      { source: 'workers_ai', verdict: 'pass' },
      { source: 'workers_ai', verdict: 'block' },
    ]);
  });

  it('refuses with 503 and a retry time when no classifier answers, and logs the outage', async () => {
    const h = harness({ moderator: unavailable, fallbackModerator: unavailable });
    await easyChallenges(h);
    const res = await signUp(h, 'Outage Bot', { description: 'Hello' });
    expect(res.status).toBe(503);
    expect(Number(res.headers.get('retry-after'))).toBeGreaterThan(0);
    const problem = await res.json();
    expect(problem.code).toBe('unavailable');
    expect(problem.detail).toContain('name');
    expect(problem.detail).toContain('get a new one');
    expect(await count(h, 'SELECT COUNT(*) AS n FROM agents')).toBe(0);
    const { results } = await h.db.prepare('SELECT layer, verdict, policy_code, source FROM moderation_log ORDER BY id').all();
    expect(results).toEqual([{ layer: 'admission', verdict: 'block', policy_code: 'outage', source: 'outage' }]);
    expect(h.log.lines.some((l) => l.event === 'profile.moderation_unavailable')).toBe(true);
  });

  it('refuses the same way in refuse mode, and when the first classifier is down with no fallback', async () => {
    const h = harness({ moderator: unavailable, fallbackModerator: null, env: { MODERATION_OUTAGE: 'refuse' } });
    await easyChallenges(h);
    expect((await signUp(h, 'Lonely Bot')).status).toBe(503);
    expect(await count(h, 'SELECT COUNT(*) AS n FROM agents')).toBe(0);
  });

  it('refuses a name or description that breaks the fixed message rules, without asking a classifier', async () => {
    let calls = 0;
    const h = harness({ moderator: { review: async () => (calls++, { verdict: 'pass' }) } });
    await easyChallenges(h);
    const cases: [string, { description?: string }, string][] = [
      ['Bit Dot Ly', { description: 'Find us at bit.ly/xyz' }, 'blocked_domain'],
      ['Invite Bot', { description: 'Join discord.gg/abcdef' }, 'invite_link'],
      ['Secret Bot', { description: 'my key is lk_abcdefghijklmnopqrstuvwxyz1234' }, 'secret_leak'],
      ['Mail Bot', { description: 'Write to ada@orrery.dev' }, 'personal_info'],
      ['bit.ly', {}, 'blocked_domain'],
    ];
    for (const [name, rest, code] of cases) {
      const res = await signUp(h, name, { ...rest, headers: ipHeader(`198.51.100.${cases.findIndex((c) => c[0] === name) + 1}`) });
      expect(res.status, name).toBe(422);
      const problem = PolicyProblem.parse(await res.json());
      expect(problem.policy_code, name).toBe(code);
      expect(problem.detail).not.toContain('lk_abc');
    }
    expect(calls).toBe(0);
    expect(await count(h, 'SELECT COUNT(*) AS n FROM agents')).toBe(0);
  });

  it('keeps the challenge when the fixed rules refuse, like any other check before the limits', async () => {
    const h = harness();
    await easyChallenges(h);
    const c = await getChallenge(h);
    const nonce = solve(c.challenge, c.difficulty);
    expect((await h.call('POST', '/v1/agents', { name: 'Fine Name', description: 'See bit.ly/x', challenge: c.challenge, nonce })).status).toBe(422);
    expect((await h.call('POST', '/v1/agents', { name: 'Fine Name', description: 'A plain one', challenge: c.challenge, nonce })).status).toBe(201);
  });

  it('does not call the classifier for names the fixed rules or uniqueness already refuse', async () => {
    let calls = 0;
    const h = harness({ moderator: { review: async () => (calls++, { verdict: 'pass' }) } });
    await easyChallenges(h);
    await signedUp(h, 'Taken Name');
    const before = calls;
    expect((await signUp(h, 'Taken Name', { headers: ipHeader('198.51.100.1') })).status).toBe(409);
    expect((await signUp(h, 'Admin', { headers: ipHeader('198.51.100.1') })).status).toBe(422);
    expect(calls).toBe(before);
  });
});
