import { ALL_SCOPES, LIMITS, RegistrationResponse, SignupChallenge } from '@logitland/contracts';
import { describe, expect, it } from 'vitest';
import { sha256 } from './crypto';
import { clientHashes, recordOrigin } from './services/origins';
import { consumeChallenge, issueChallenge, leadingZeroBits } from './services/pow';
import { hit } from './services/limits';
import { checkName } from './services/names';
import { updateSettings } from './services/settings';
import { register } from './services/signup';
import type { Moderator } from './services/moderation/classifier';
import { count, easyChallenges, getChallenge, ipHeader, signUp, signedUp, solve } from './signup.helpers';
import { harness, seedAgent, type Harness } from './testing';

const verdict = (v: 'pass' | 'hold' | 'block', policy_code?: 'harassment' | 'spam', reason = 'test'): Moderator => ({
  review: async () => ({ verdict: v, policy_code, reason }),
});
const unavailable: Moderator = { review: async () => ({ verdict: null, unavailable: true, reason: 'down' }) };
const refuseWhen = (word: string, code: 'harassment' | 'spam'): Moderator => ({
  review: async (req) => (req.content.includes(word) ? { verdict: 'block', policy_code: code, reason: 'matched' } : { verdict: 'pass' }),
});

/** POST /agent/identity with a challenge already in hand, so a test can reuse (or race) one solution. */
const registerWith = (h: Harness, name: string, challenge: string, nonce: string, headers: Record<string, string> = {}) =>
  h.call('POST', '/agent/identity', { type: 'anonymous', name, pow: { challenge, nonce } }, headers);

describe('proof of work', () => {
  it('issues a challenge that lives five minutes at the configured difficulty', async () => {
    const h = harness();
    const res = await h.call('GET', '/agent/identity/challenge');
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
        (await seedAgent(h.relay, { level: 0 })).id,
        { ip: `203.0.113.${20 + i}`, asn: null, asOrganization: null, country: null },
        'signup',
      );
    expect((await getChallenge(h)).difficulty).toBe(LIMITS.powMaxDifficulty);
  });

  it('limits how many challenges a network can ask for', async () => {
    const h = harness();
    for (let i = 0; i < 60; i++) expect((await h.call('GET', '/agent/identity/challenge')).status).toBe(200);
    const res = await h.call('GET', '/agent/identity/challenge');
    expect(res.status).toBe(429);
    expect(Number(res.headers.get('retry-after'))).toBeGreaterThan(0);
    expect((await h.call('GET', '/agent/identity/challenge', undefined, ipHeader('198.51.100.5'))).status).toBe(200);
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
    expect((await registerWith(h, 'Once', c.challenge, nonce)).status).toBe(200);
    expect((await registerWith(h, 'Twice', c.challenge, nonce)).status).toBe(409);
    expect(await count(h, 'SELECT COUNT(*) AS n FROM agents')).toBe(1);
  });

  it('lets only one of two simultaneous signups use the same challenge', async () => {
    const h = harness();
    await easyChallenges(h);
    const c = await getChallenge(h);
    const nonce = solve(c.challenge, c.difficulty);
    const post = (name: string, ip: string) => registerWith(h, name, c.challenge, nonce, ipHeader(ip));
    const statuses = (await Promise.all([post('Racer One', '203.0.113.20'), post('Racer Two', '203.0.113.21')])).map((r) => r.status).sort();
    expect(statuses).toEqual([200, 409]);
  });

  it('refuses unknown challenges, wrong nonces and expired challenges', async () => {
    const h = harness();
    await easyChallenges(h);
    expect((await registerWith(h, 'Nobody', 'pow_NOPE', '1')).status).toBe(400);

    const c = await getChallenge(h);
    let wrong = 0;
    while (leadingZeroBits(await sha256(`${c.challenge}:${wrong}`)) >= c.difficulty) wrong++;
    const bad = await registerWith(h, 'Nonce', c.challenge, String(wrong));
    expect(bad.status).toBe(400);
    expect((await bad.json()).error_description).toContain(`${c.difficulty} zero bits`);
    // A wrong answer doesn't spend the challenge.
    expect((await registerWith(h, 'Nonce', c.challenge, solve(c.challenge, c.difficulty))).status).toBe(200);

    const old = await getChallenge(h, ipHeader('198.51.100.3'));
    h.advance(LIMITS.powTtlSeconds * 1000 + 1000);
    const expired = await registerWith(h, 'Late', old.challenge, solve(old.challenge, old.difficulty), ipHeader('198.51.100.3'));
    expect(expired.status).toBe(410);
    expect((await expired.json()).error_description).toContain('expired');
  });

  it('only works from the network it was issued to, and is not spent by a refusal from another', async () => {
    const h = harness();
    await easyChallenges(h);
    const c = await getChallenge(h);
    const nonce = solve(c.challenge, c.difficulty);
    const elsewhere = await registerWith(h, 'Borrowed', c.challenge, nonce, ipHeader('198.51.100.9'));
    expect(elsewhere.status).toBe(403);
    expect((await elsewhere.json()).error_description).toContain('different network');
    expect(await h.db.prepare('SELECT used_at FROM pow_challenges WHERE id = ?').bind(c.challenge).first()).toEqual({ used_at: null });
    // Another address in the same /24 is the same network.
    expect((await registerWith(h, 'Borrowed', c.challenge, nonce, ipHeader('203.0.113.200'))).status).toBe(200);
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
  it('registers an orphan with no Discord account involved, keeping only a hash of its claim token', async () => {
    const h = harness();
    await easyChallenges(h);
    const res = await signUp(h, 'Orrery Bot');
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    const body = RegistrationResponse.parse(await res.json());
    expect(body).toMatchObject({ name: 'Orrery Bot', pre_claim_scopes: ALL_SCOPES, claim_url: 'https://relay.logitland.test/agent/identity/claim' });
    expect(body.claim_token).toMatch(/^clm_/);

    const agent = await h.db.prepare('SELECT * FROM agents WHERE id = ?').bind(body.registration_id).first<Record<string, unknown>>();
    expect(agent).toMatchObject({ kind: 'agent', owner_id: null, name: 'Orrery Bot', name_key: 'orrerybot', level: 0, xp: 0, status: 'active' });
    expect(agent!.claim_token_hash).toBe(await sha256(body.claim_token));
    expect(await h.db.prepare("SELECT * FROM audit_log WHERE action = 'agent.registered'").first()).toMatchObject({
      actor_type: 'agent',
      actor_id: body.registration_id,
      target_id: body.registration_id,
    });
    expect(h.discordCalls).toHaveLength(0);
  });

  it('records where the agent signed up from', async () => {
    const h = harness();
    await easyChallenges(h);
    const body = await signedUp(h, 'Origin Bot');
    const origin = await h.db.prepare('SELECT * FROM agent_origins WHERE agent_id = ?').bind(body.registration_id).first<Record<string, unknown>>();
    expect(origin).toMatchObject({ kind: 'signup' });
    expect(origin!.ip_hmac).toMatch(/^[0-9a-f]{64}$/);
    expect(origin!.ip_sealed).toBeTruthy();
    expect(JSON.stringify(origin)).not.toContain('203.0.113.7');
  });

  it('is refused with 403 while signups are closed, and no challenge is issued', async () => {
    const h = harness();
    await easyChallenges(h);
    const c = await getChallenge(h);
    await updateSettings(h.relay, 'own_test_setup', { signup_open: false });
    const res = await registerWith(h, 'Closed', c.challenge, solve(c.challenge, c.difficulty));
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ error: 'anonymous_not_enabled' });
    expect((await h.call('GET', '/agent/identity/challenge')).status).toBe(403);
    expect(await count(h, 'SELECT COUNT(*) AS n FROM agents')).toBe(0);
    await updateSettings(h.relay, 'own_test_setup', { signup_open: true });
    expect((await signUp(h, 'Reopened')).status).toBe(200);
  });

  it('rejects malformed requests', async () => {
    const h = harness();
    expect((await h.call('POST', '/agent/identity', { type: 'anonymous', name: 'x' })).status).toBe(400);
    expect((await h.call('POST', '/agent/identity', { type: 'anonymous', name: 'Fine', pow: { challenge: 'nope', nonce: '1' } })).status).toBe(400);
  });
});

describe('signup limits', () => {
  it('allows 3 signups an hour from one address', async () => {
    const h = harness();
    await easyChallenges(h);
    for (const n of [1, 2, 3]) expect((await signUp(h, `Same Ip ${n}`)).status).toBe(200);
    const fourth = await signUp(h, 'Same Ip 4');
    expect(fourth.status).toBe(429);
    expect(Number(fourth.headers.get('retry-after'))).toBeGreaterThan(0);
    expect((await signUp(h, 'Other Ip', { headers: ipHeader('203.0.113.99') })).status).toBe(200);
    h.advance(61 * 60_000);
    expect((await signUp(h, 'Same Ip 5')).status).toBe(200);
  });

  it('allows 5 signups an hour from one network, whichever addresses they use', async () => {
    const h = harness();
    await easyChallenges(h);
    const statuses: number[] = [];
    for (const ip of ['203.0.113.1', '203.0.113.1', '203.0.113.2', '203.0.113.2', '203.0.113.3', '203.0.113.4']) {
      statuses.push((await signUp(h, `Net ${statuses.length}`, { headers: ipHeader(ip) })).status);
    }
    expect(statuses).toEqual([200, 200, 200, 200, 200, 429]);
    expect((await signUp(h, 'Elsewhere', { headers: ipHeader('203.0.114.1') })).status).toBe(200);
  });

  it('treats every address in an IPv6 /64 as one address', async () => {
    const h = harness();
    await easyChallenges(h);
    const statuses: number[] = [];
    for (let i = 1; i <= 5; i++) statuses.push((await signUp(h, `Six ${i}`, { headers: ipHeader(`2001:db8:1:2::${i}`) })).status);
    expect(statuses).toEqual([200, 200, 200, 429, 429]);
    expect((await signUp(h, 'Next door', { headers: ipHeader('2001:db8:1:3::1') })).status).toBe(200);
  });

  it('treats every /64 in an IPv6 /48 as one network', async () => {
    const h = harness();
    await easyChallenges(h);
    const statuses: number[] = [];
    for (let i = 1; i <= 6; i++) statuses.push((await signUp(h, `Broker ${i}`, { headers: ipHeader(`2001:db8:7:${i}::1`) })).status);
    expect(statuses).toEqual([200, 200, 200, 200, 200, 429]);
    expect((await signUp(h, 'Other prefix', { headers: ipHeader('2001:db8:8::1') })).status).toBe(200);
  });

  it('allows 30 signups an hour from one provider, however many networks it has', async () => {
    const h = harness();
    await easyChallenges(h);
    const signAs = async (name: string, ip: string, asn: number | null) => {
      const client = { ip, asn, asOrganization: null, country: null };
      const c = await issueChallenge(h.relay, client);
      return register(h.relay, { type: 'anonymous', name, pow: { challenge: c.challenge, nonce: solve(c.challenge, c.difficulty) } }, client).then(
        () => 200,
        (e: { status: number }) => e.status,
      );
    };
    const statuses: number[] = [];
    for (let i = 0; i <= LIMITS.signupsPerAsnPerHour; i++) statuses.push(await signAs(`Provider ${i}`, `198.51.${100 + i}.1`, 64500));
    expect(statuses.filter((s) => s === 200)).toHaveLength(LIMITS.signupsPerAsnPerHour);
    expect(statuses.at(-1)).toBe(429);
    expect(await signAs('Other provider', '192.0.2.77', 64501)).toBe(200);
    expect(await signAs('No provider known', '192.0.2.78', null)).toBe(200);
  });

  it('stops all signups for the hour once the relay-wide cap is reached', async () => {
    const h = harness();
    await easyChallenges(h);
    for (let i = 0; i < LIMITS.signupsPerHour; i++) await hit(h.relay, { key: 'signup:all:h', limit: LIMITS.signupsPerHour, windowSeconds: 3600 });
    const res = await signUp(h, 'Too Late', { headers: ipHeader('198.51.100.40') });
    expect(res.status).toBe(429);
    expect(await count(h, 'SELECT COUNT(*) AS n FROM agents')).toBe(0);
    h.advance(61 * 60_000);
    expect((await signUp(h, 'On Time', { headers: ipHeader('198.51.100.40') })).status).toBe(200);
  });

  it('allows 20 signups a day from one network', async () => {
    const h = harness();
    await easyChallenges(h);
    let made = 0;
    for (let hour = 0; hour < 4; hour++) {
      for (const ip of ['203.0.113.1', '203.0.113.1', '203.0.113.1', '203.0.113.2', '203.0.113.2']) {
        expect((await signUp(h, `Day ${made++}`, { headers: ipHeader(ip) })).status).toBe(200);
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
    expect((await registerWith(h, 'Blocked', c.challenge, nonce)).status).toBe(429);
    expect(await h.db.prepare('SELECT used_at FROM pow_challenges WHERE id = ?').bind(c.challenge).first()).toEqual({ used_at: null });
    expect((await registerWith(h, 'Blocked', c.challenge, nonce, ipHeader('203.0.113.50'))).status).toBe(200);
  });
});

describe('signup names', () => {
  it('refuses a reserved name with 422 and a reason, and keeps the challenge', async () => {
    const h = harness();
    await easyChallenges(h);
    const c = await getChallenge(h);
    const nonce = solve(c.challenge, c.difficulty);
    const res = await registerWith(h, 'Admin', c.challenge, nonce);
    expect(res.status).toBe(422);
    expect((await res.json()).error_description).toContain('admin');
    expect((await registerWith(h, 'Adamant', c.challenge, nonce)).status).toBe(200);
  });

  it.each([
    ['Adm1n', 'impersonation'],
    ['Logitland Support', 'impersonation'],
    ['0fficial Staff', 'impersonation'],
    ['m.o.d', 'impersonation'],
    ['Server Mod', 'impersonation'],
    ['Bad$Name', 'name_policy'],
    ['Emoji 🙂 Bot', 'name_policy'],
    ['--', 'name_policy'],
    ['bit.ly', 'blocked_domain'],
  ])('refuses %j as %s', (name, code) => {
    expect(checkName(name)).toMatchObject({ ok: false, code });
  });

  it('refuses names outside 2 to 32 characters while validating the request', async () => {
    const h = harness();
    await easyChallenges(h);
    for (const name of ['x', 'a b c d e f g h i j k l m n o p q r s t u v w x y z']) {
      const res = await signUp(h, name);
      expect(res.status).toBe(400);
      expect((await res.json()).error_description).toContain('name:');
    }
  });

  it('accepts ordinary names that merely contain a short reserved word', async () => {
    const h = harness();
    await easyChallenges(h);
    for (const [i, name] of ['Model Maker', 'Somewhere', 'Modern Bot', "Léa O'Neil", 'Ada-2'].entries()) {
      expect((await signUp(h, name, { headers: ipHeader(`198.51.100.${i + 1}`) })).status).toBe(200);
    }
  });

  it('answers 409 when the name is taken, including by a lookalike, and keeps the challenge', async () => {
    const h = harness();
    await easyChallenges(h);
    await signedUp(h, 'Logan Bot');
    const ip = ipHeader('198.51.100.1');
    const c = await getChallenge(h, ip);
    const nonce = solve(c.challenge, c.difficulty);
    for (const name of ['Logan Bot', 'logan-bot', 'L0gan B0t']) {
      const res = await registerWith(h, name, c.challenge, nonce, ip);
      expect(res.status).toBe(409);
      expect((await res.json()).error_description).toContain('That name is taken');
    }
    // Latin mixed with Cyrillic is refused outright.
    expect((await registerWith(h, 'Lоgan Bоt', c.challenge, nonce, ip)).status).toBe(422);
    expect((await registerWith(h, 'Logan Two', c.challenge, nonce, ip)).status).toBe(200);
  });

  it('stores the plain-letter form of a fancy-font name', async () => {
    const h = harness();
    await easyChallenges(h);
    const body = await signedUp(h, '𝐁𝐨𝐥𝐝 𝐁𝐨𝐭');
    expect(body.name).toBe('Bold Bot');
    expect((await h.db.prepare('SELECT name FROM agents WHERE id = ?').bind(body.registration_id).first<{ name: string }>())!.name).toBe('Bold Bot');
  });
});

describe('signup moderation', () => {
  it('logs a pass for the name', async () => {
    const h = harness();
    await easyChallenges(h);
    const body = await signedUp(h, 'Clean Bot');
    const { results } = await h.db.prepare('SELECT * FROM moderation_log ORDER BY id').all<Record<string, unknown>>();
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({ agent_id: body.registration_id, layer: 'admission', verdict: 'pass', policy_code: null, source: 'jev', reason: 'name' });
  });

  it('refuses a blocked name with 422, naming the classifier’s policy code', async () => {
    const h = harness({ moderator: refuseWhen('Slur', 'harassment') });
    await easyChallenges(h);
    const res = await signUp(h, 'Slurbot');
    expect(res.status).toBe(422);
    const { error_description } = await res.json();
    expect(error_description).toContain('(harassment)');
    expect(error_description).toContain('Pick a different name');
    expect(await count(h, 'SELECT COUNT(*) AS n FROM agents')).toBe(0);
    expect(await h.db.prepare('SELECT layer, verdict, policy_code, source FROM moderation_log').first()).toEqual({
      layer: 'admission',
      verdict: 'block',
      policy_code: 'harassment',
      source: 'jev',
    });
  });

  it('defaults a refused name without a code to name_policy', async () => {
    const h = harness({ moderator: verdict('hold') });
    await easyChallenges(h);
    const res = await signUp(h, 'No Code');
    expect(res.status).toBe(422);
    expect((await res.json()).error_description).toContain('(name_policy)');
    expect(await h.db.prepare('SELECT verdict, policy_code FROM moderation_log').first()).toEqual({ verdict: 'hold', policy_code: 'name_policy' });
  });

  it('spends the challenge when moderation refuses', async () => {
    const h = harness({ moderator: verdict('block', 'spam') });
    await easyChallenges(h);
    const c = await getChallenge(h);
    const nonce = solve(c.challenge, c.difficulty);
    const first = await registerWith(h, 'Spammy', c.challenge, nonce);
    expect(first.status).toBe(422);
    expect((await first.json()).error_description).toContain('get a new one');
    expect((await registerWith(h, 'Other', c.challenge, nonce)).status).toBe(409);
  });

  it('refuses with 503 and a retry time when no classifier answers, and logs the outage', async () => {
    const h = harness({ moderator: unavailable });
    await easyChallenges(h);
    const res = await signUp(h, 'Outage Bot');
    expect(res.status).toBe(503);
    expect(Number(res.headers.get('retry-after'))).toBeGreaterThan(0);
    const body = await res.json();
    expect(body.error).toBe('temporarily_unavailable');
    expect(body.error_description).toContain('name');
    expect(body.error_description).toContain('get a new one');
    expect(await count(h, 'SELECT COUNT(*) AS n FROM agents')).toBe(0);
    const { results } = await h.db.prepare('SELECT layer, verdict, policy_code, source FROM moderation_log ORDER BY id').all();
    expect(results).toEqual([{ layer: 'admission', verdict: 'block', policy_code: 'outage', source: 'outage' }]);
    expect(h.log.lines.some((l) => l.event === 'profile.moderation_unavailable')).toBe(true);
  });

  it('refuses the same way in refuse mode', async () => {
    const h = harness({ moderator: unavailable, env: { MODERATION_OUTAGE: 'refuse' } });
    await easyChallenges(h);
    expect((await signUp(h, 'Lonely Bot')).status).toBe(503);
    expect(await count(h, 'SELECT COUNT(*) AS n FROM agents')).toBe(0);
  });

  it('refuses a name that breaks the fixed rules without asking a classifier, and keeps the challenge', async () => {
    let calls = 0;
    const h = harness({ moderator: { review: async () => (calls++, { verdict: 'pass' }) } });
    await easyChallenges(h);
    const c = await getChallenge(h);
    const nonce = solve(c.challenge, c.difficulty);
    expect((await registerWith(h, 'bit.ly', c.challenge, nonce)).status).toBe(422);
    expect(calls).toBe(0);
    expect((await registerWith(h, 'Fine Name', c.challenge, nonce)).status).toBe(200);
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
