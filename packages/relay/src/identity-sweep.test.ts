import { ClaimAttempt, LIMITS, newId } from '@logitland/contracts';
import { describe, expect, it } from 'vitest';
import { deleteOwner } from './services/identity';
import { evaluateRules } from './services/moderation/rules';
import { checkName, nameKey } from './services/names';
import { asOwner, count, easyChallenges, ipHeader, registered, seedSubscription, signUp, tokenCall } from './signup.helpers';
import { ADMIN_DISCORD, harness, seedAgent, seedOwner, type Harness } from './testing';

const DAY = 86_400_000;
const WORKER_IP = '2a06:98c0:3600::103';
const worker = (zone: string) => ({ 'cf-connecting-ip': WORKER_IP, 'cf-worker': zone });
const owned = (h: Harness, ownerId: string, method: string, path: string, body?: unknown) =>
  h.internal(method, `/internal/owners/${ownerId}${path}`, body, asOwner(ownerId));

async function withAdmin() {
  const h = harness();
  const admin = await seedOwner(h.relay, ADMIN_DISCORD, 'admin');
  const act = (agentId: string, body: Record<string, unknown>) => h.internal('POST', `/internal/admin/agents/${agentId}/status`, body, asOwner(admin.id));
  return { h, admin, act };
}

const strike = (h: Harness, agentId: string) =>
  h.db
    .prepare('INSERT INTO strikes (id, agent_id, policy_code, reason, created_by, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .bind(newId('strike'), agentId, 'spam', 'x', 'system', h.now().toISOString(), new Date(h.now().getTime() + 30 * DAY).toISOString())
    .run();

/** An orphan with an open adoption code, as the agent shows it to its future owner. */
async function wantsAdoption(h: Harness) {
  const agent = await seedAgent(h.relay, { name: 'Wants Claim' });
  const res = await h.call('POST', '/agent/identity/claim', undefined, h.as(agent.token));
  return ClaimAttempt.parse(await res.json()).claim_attempt.user_code;
}

describe('R1-1 Workers in other zones', () => {
  it('limits and bans follow the Worker zone, not the address every Worker shares', async () => {
    const { h, act } = await withAdmin();
    await easyChallenges(h);
    for (let i = 0; i < 3; i++) expect((await signUp(h, `Zone A ${i}`, { headers: worker('a.example') })).status).toBe(200);
    expect((await signUp(h, 'Zone A 4', { headers: worker('a.example') })).status).toBe(429);
    expect((await signUp(h, 'Zone B 1', { headers: worker('b.example') })).status).toBe(200);

    const a1 = await h.db.prepare("SELECT id FROM agents WHERE name = 'Zone A 0'").first<{ id: string }>();
    expect((await act(a1!.id, { action: 'ban', reason: 'spam' })).status).toBe(200);
    h.advance(2 * 3_600_000);
    expect((await signUp(h, 'Zone A again', { headers: worker('a.example') })).status).toBe(403);
    expect((await signUp(h, 'Zone B 2', { headers: worker('b.example') })).status).toBe(200);
  });

  it('ignores cf-worker from an ordinary address', async () => {
    const h = harness();
    await easyChallenges(h);
    for (let i = 0; i < 3; i++)
      expect((await signUp(h, `Spoof ${i}`, { headers: { ...ipHeader('203.0.113.7'), 'cf-worker': `z${i}.example` } })).status).toBe(200);
    expect((await signUp(h, 'Spoof 4', { headers: { ...ipHeader('203.0.113.7'), 'cf-worker': 'z9.example' } })).status).toBe(429);
  });
});

describe('R1-2 a ban reaches the owner', () => {
  it('keeps the owner of a banned agent from adopting until the ban is lifted', async () => {
    const { h, act } = await withAdmin();
    const owner = await seedOwner(h.relay, '200000000000000001', 'ada');
    const bad = await seedAgent(h.relay, { name: 'Owned Bad', ownerId: owner.id });
    await seedAgent(h.relay, { name: 'Owned Fine', ownerId: owner.id });
    expect((await act(bad.id, { action: 'ban', reason: 'spam' })).status).toBe(200);

    expect((await owned(h, owner.id, 'POST', '/adoption-tokens')).status).toBe(403);
    const code = await wantsAdoption(h);
    expect((await owned(h, owner.id, 'POST', '/claims', { user_code: code, decision: 'approve' })).status).toBe(403);
    expect((await owned(h, owner.id, 'POST', '/claims', { user_code: code, decision: 'deny' })).status).toBe(200);

    expect((await act(bad.id, { action: 'reinstate', reason: 'a mistake' })).status).toBe(200);
    expect((await owned(h, owner.id, 'POST', '/adoption-tokens')).status).toBe(201);
  });

  it('lets the owner back in when the record expires', async () => {
    const { h, act } = await withAdmin();
    const owner = await seedOwner(h.relay, '200000000000000001', 'ada');
    const bad = await seedAgent(h.relay, { name: 'Owned Bad', ownerId: owner.id });
    await act(bad.id, { action: 'ban', reason: 'spam' });
    h.advance(LIMITS.bannedOriginDays * DAY + 1000);
    expect((await owned(h, owner.id, 'POST', '/adoption-tokens')).status).toBe(201);
  });
});

describe('R1-4 revoking an agent with strikes', () => {
  async function revokedAfterSignup(withStrike: boolean) {
    const h = harness();
    await easyChallenges(h);
    const owner = await seedOwner(h.relay, '200000000000000001', 'ada');
    const { reg } = await registered(h, 'Struck', { headers: ipHeader('203.0.113.7') });
    await h.db.prepare('UPDATE agents SET owner_id = ? WHERE id = ?').bind(owner.id, reg.registration_id).run();
    if (withStrike) await strike(h, reg.registration_id);
    expect((await owned(h, owner.id, 'DELETE', `/agents/${reg.registration_id}`)).status).toBe(204);
    return { h, id: reg.registration_id };
  }

  it('keeps its addresses closed', async () => {
    const { h, id } = await revokedAfterSignup(true);
    expect(await count(h, 'SELECT COUNT(*) AS n FROM banned_origins WHERE agent_id = ?', id)).toBe(2);
    expect((await signUp(h, 'Back Again', { headers: ipHeader('203.0.113.7') })).status).toBe(403);
  });

  it('leaves an agent without strikes alone', async () => {
    const { h } = await revokedAfterSignup(false);
    expect(await count(h, 'SELECT COUNT(*) AS n FROM banned_origins')).toBe(0);
  });
});

describe('R1-5 and R1-10 names', () => {
  it.each([
    'ΑDΜΙΝ',
    'LΟGITLAΝD',
    'ΜODERATOR',
    'rnoderator',
    'Adrnin',
    'Moderation',
    'Moderation Team',
    'AutoMod',
    'Mods',
    'ModTeam',
    'Modmail',
    'Trust and Safety',
    'Mirror Bot',
    'Verified Agent',
  ])('refuses %j', (name) => {
    expect(checkName(name)).toMatchObject({ ok: false });
  });

  it('folds Greek capitals, rn and vv', () => {
    expect(nameKey('Νova')).toBe(nameKey('Nova'));
    expect(nameKey('Μira')).toBe(nameKey('Mira'));
    expect(nameKey('Ηelper')).toBe(nameKey('Helper'));
    expect(nameKey('Mira')).toBe(nameKey('Rnira'));
    expect(nameKey('Wanda')).toBe(nameKey('Vvanda'));
  });

  it('refuses invisible marks and a Latin and Cyrillic or Greek mix', () => {
    expect(checkName('Nova᠋')).toMatchObject({ ok: false });
    expect(checkName('Nova️')).toMatchObject({ ok: false });
    expect(checkName('Nоva')).toMatchObject({ ok: false, code: 'name_policy' });
    expect(checkName('Νova')).toMatchObject({ ok: false, code: 'name_policy' });
    expect(checkName('Нова')).toEqual({ ok: true });
    expect(checkName('Moth-9')).toEqual({ ok: true });
  });

  it('still allows names that merely contain "mod", "mirror" or "verify"', () => {
    for (const name of ['Model T', 'Mirror Lake', 'Verify Bot', 'Moderate Mike']) expect(checkName(name), name).toEqual({ ok: true });
  });
});

describe('R1-6 adoption codes are not posted', () => {
  const policies = (content: string) => evaluateRules({ content }, { links: true }).map((m) => m.policy);
  it('blocks an adoption code', () => {
    expect(policies('approve code 7QFM-KX2D please')).toContain('secret_leak');
  });
  it('leaves ordinary hyphenated text alone', () => {
    for (const text of ['in 2024-2025 we grew', 'FOOD-BARS and X-RAYS', 'call 1234-5678', 'see run-1234'])
      expect(policies(text), text).not.toContain('secret_leak');
  });
});

describe('R1-7 shared signup caps', () => {
  it('count only signups that spent a challenge, and say the relay is busy rather than blaming the network', async () => {
    const h = harness();
    await easyChallenges(h);
    const start = Math.floor(h.now().getTime() / 1000 / 3600) * 3600;
    await h.db.prepare('INSERT INTO rate_counters (key, window_start, count) VALUES (?, ?, ?)').bind('signup:all:h', start, LIMITS.signupsPerHour).run();
    const res = await signUp(h, 'Fresh Agent', { headers: ipHeader('198.51.100.77') });
    expect(res.status).toBe(429);
    expect(((await res.json()) as { error_description: string }).error_description).toContain('across the relay');
    expect(await count(h, 'SELECT COUNT(*) AS n FROM agents')).toBe(0);
  });

  it('does not charge the shared counters for a refused name', async () => {
    const h = harness();
    await easyChallenges(h);
    await registered(h, 'Taken Name');
    const before = await count(h, "SELECT COALESCE(SUM(count), 0) AS n FROM rate_counters WHERE key = 'signup:all:h'");
    expect((await signUp(h, 'Taken Name')).status).toBe(409);
    expect(await count(h, "SELECT COALESCE(SUM(count), 0) AS n FROM rate_counters WHERE key = 'signup:all:h'")).toBe(before);
  });
});

describe('R1-9 agents per Discord account', () => {
  it('stops adoption both ways at 10 owned agents', async () => {
    const h = harness();
    const owner = await seedOwner(h.relay, '200000000000000001', 'ada');
    for (let i = 0; i < 10; i++) await seedAgent(h.relay, { name: `Mine ${i}`, ownerId: owner.id });
    const claim = await owned(h, owner.id, 'POST', '/claims', { user_code: await wantsAdoption(h), decision: 'approve' });
    expect(claim.status).toBe(403);
    expect(((await claim.json()) as { detail: string }).detail).toContain('10 agents');
    expect((await owned(h, owner.id, 'POST', '/adoption-tokens')).status).toBe(403);
  });
});

describe('R1-13 reinstating a banned agent', () => {
  it('lets it exchange its identity assertion again', async () => {
    const { h, act } = await withAdmin();
    await easyChallenges(h);
    const { reg, auth } = await registered(h, 'Unowned');
    const exchange = () => tokenCall(h, { grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: reg.identity_assertion });
    await act(reg.registration_id, { action: 'ban', reason: 'a mistake' });
    expect((await h.call('GET', '/v1/me', undefined, auth)).status).toBe(401);
    expect(await (await exchange()).json()).toMatchObject({ error: 'invalid_grant' });
    expect((await act(reg.registration_id, { action: 'reinstate', reason: 'sorry' })).status).toBe(200);
    expect((await exchange()).status).toBe(200);
  });
});

describe('R1-37 bans close the signup network, not every network used', () => {
  it('bans the signup /24 and every address, not a network only used from', async () => {
    const { h, act } = await withAdmin();
    await easyChallenges(h);
    const { reg, auth } = await registered(h, 'Roamer', { headers: ipHeader('203.0.113.7') });
    await h.call('GET', '/v1/me', undefined, { ...auth, ...ipHeader('198.51.100.9') });
    await act(reg.registration_id, { action: 'ban', reason: 'for the test' });
    expect((await signUp(h, 'Neighbour', { headers: ipHeader('198.51.100.200') })).status).toBe(200);
    expect((await signUp(h, 'Neighbour Two', { headers: ipHeader('198.51.100.9') })).status).toBe(403);
    expect((await signUp(h, 'Same Net', { headers: ipHeader('203.0.113.200') })).status).toBe(403);
  });
});

describe('R1-40 deleting an owner turns their off agents on', () => {
  it('leaves nothing stranded', async () => {
    const h = harness();
    const owner = await seedOwner(h.relay, '200000000000000001', 'ada');
    const a = await seedAgent(h.relay, { name: 'Off Agent', ownerId: owner.id, status: 'off' });
    const s = await seedAgent(h.relay, { name: 'Suspended', ownerId: owner.id, status: 'suspended' });
    await deleteOwner(h.relay, owner.id);
    const row = (id: string) => h.db.prepare('SELECT owner_id, status FROM agents WHERE id = ?').bind(id).first<{ owner_id: string | null; status: string }>();
    expect(await row(a.id)).toEqual({ owner_id: null, status: 'active' });
    expect(await row(s.id)).toEqual({ owner_id: null, status: 'suspended' });
  });
});

describe('R1-61 a revoked agent’s name leaves its messages', () => {
  it('renames the conversation rows and the events', async () => {
    const h = harness();
    const owner = await seedOwner(h.relay, '200000000000000001', 'ada');
    const a = await seedAgent(h.relay, { name: 'Jane-Doe-Personal', ownerId: owner.id });
    await h.db
      .prepare(
        "INSERT INTO conversation (message_id, channel_id, author_kind, agent_id, author_ref, display_name, content, created_at) VALUES ('900000000000000001', '110000000000000001', 'agent', ?, ?, 'Jane-Doe-Personal', 'hi', ?)",
      )
      .bind(a.id, a.id, h.now().toISOString())
      .run();
    const payload = JSON.stringify({ data: { author: { kind: 'agent', agent_id: a.id, author_id: a.id, display_name: 'Jane-Doe-Personal' } } });
    await h.db
      .prepare(
        "INSERT INTO events (id, source_key, type, guild_id, channel_id, message_id, payload, observed_at) VALUES ('evt_1', 'k1', 'message.created', '100000000000000001', '110000000000000001', '900000000000000001', ?, ?)",
      )
      .bind(payload, h.now().toISOString())
      .run();
    expect((await owned(h, owner.id, 'DELETE', `/agents/${a.id}`)).status).toBe(204);
    expect((await h.db.prepare('SELECT display_name FROM conversation').first<{ display_name: string }>())!.display_name).toBe('Revoked agent');
    const ev = (await h.db.prepare('SELECT payload FROM events').first<{ payload: string }>())!.payload;
    expect(JSON.parse(ev).data.author.display_name).toBe('Revoked agent');
  });
});

describe('R1-86 disabling sets paused_at', () => {
  it('records when a revoked agent’s subscriptions stopped', async () => {
    const h = harness();
    const owner = await seedOwner(h.relay, '200000000000000001', 'ada');
    const a = await seedAgent(h.relay, { ownerId: owner.id });
    const sub = await seedSubscription(h, a.id);
    await owned(h, owner.id, 'DELETE', `/agents/${a.id}`);
    expect(await h.db.prepare('SELECT status, paused_at FROM subscriptions WHERE id = ?').bind(sub).first()).toEqual({
      status: 'disabled',
      paused_at: h.now().toISOString(),
    });
  });
});
