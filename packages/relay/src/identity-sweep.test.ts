import { LIMITS, newId } from '@logitland/contracts';
import { describe, expect, it } from 'vitest';
import { adminAct, deleteAgent, deleteOwner } from './services/identity';
import { evaluateRules } from './services/moderation/rules';
import { checkName, nameKey } from './services/names';
import { updateSettings } from './services/settings';
import { asOwner, count, easyChallenges, ipHeader, signUp, signedUp, seedSubscription } from './signup.helpers';
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

describe('R1-1 Workers in other zones', () => {
  it('limits and bans follow the Worker zone, not the address every Worker shares', async () => {
    const { h, act } = await withAdmin();
    await easyChallenges(h);
    for (let i = 0; i < 3; i++) expect((await signUp(h, `Zone A ${i}`, { headers: worker('a.example') })).status).toBe(201);
    expect((await signUp(h, 'Zone A 4', { headers: worker('a.example') })).status).toBe(429);
    const b = await signUp(h, 'Zone B 1', { headers: worker('b.example') });
    expect(b.status).toBe(201);

    const a1 = await h.db.prepare("SELECT id FROM agents WHERE name = 'Zone A 0'").first<{ id: string }>();
    expect((await act(a1!.id, { action: 'ban', reason: 'spam' })).status).toBe(200);
    h.advance(2 * 3_600_000);
    expect((await signUp(h, 'Zone A again', { headers: worker('a.example') })).status).toBe(403);
    expect((await signUp(h, 'Zone B 2', { headers: worker('b.example') })).status).toBe(201);
  });

  it('ignores cf-worker from an ordinary address', async () => {
    const h = harness();
    await easyChallenges(h);
    for (let i = 0; i < 3; i++)
      expect((await signUp(h, `Spoof ${i}`, { headers: { ...ipHeader('203.0.113.7'), 'cf-worker': `z${i}.example` } })).status).toBe(201);
    expect((await signUp(h, 'Spoof 4', { headers: { ...ipHeader('203.0.113.7'), 'cf-worker': 'z9.example' } })).status).toBe(429);
  });
});

describe('R1-2 a ban reaches the owner', () => {
  it('keeps the owner of a banned agent from registering or claiming until the ban ends or is lifted', async () => {
    const { h, act } = await withAdmin();
    await easyChallenges(h);
    const owner = await seedOwner(h.relay, '200000000000000001', 'ada');
    const bad = await seedAgent(h.relay, { name: 'Owned Bad', ownerId: owner.id });
    await seedAgent(h.relay, { name: 'Owned Fine', ownerId: owner.id });
    expect((await act(bad.id, { action: 'ban', reason: 'spam' })).status).toBe(200);

    const register = await owned(h, owner.id, 'POST', '/agents', { name: 'Replacement', scopes: ['messages:read'] });
    expect(register.status).toBe(403);
    const other = await signedUp(h, 'Wants Claim');
    const claim = await owned(h, owner.id, 'POST', '/claims', { user_code: other.claim.user_code, decision: 'approve' });
    expect(claim.status).toBe(403);
    expect((await owned(h, owner.id, 'POST', '/claims', { user_code: other.claim.user_code, decision: 'deny' })).status).toBe(200);

    expect((await act(bad.id, { action: 'reinstate', reason: 'a mistake' })).status).toBe(200);
    expect((await owned(h, owner.id, 'POST', '/agents', { name: 'Replacement', scopes: ['messages:read'] })).status).toBe(201);
  });

  it('lets the owner back in when the record expires', async () => {
    const { h, act } = await withAdmin();
    const owner = await seedOwner(h.relay, '200000000000000001', 'ada');
    const bad = await seedAgent(h.relay, { name: 'Owned Bad', ownerId: owner.id });
    await act(bad.id, { action: 'ban', reason: 'spam' });
    h.advance(LIMITS.bannedOriginDays * DAY + 1000);
    expect((await owned(h, owner.id, 'POST', '/agents', { name: 'Replacement', scopes: ['messages:read'] })).status).toBe(201);
  });
});

describe('R1-4 deleting an agent with strikes', () => {
  it('keeps its addresses closed', async () => {
    const h = harness();
    await easyChallenges(h);
    const owner = await seedOwner(h.relay, '200000000000000001', 'ada');
    const a = await signedUp(h, 'Struck', { headers: ipHeader('203.0.113.7') });
    await h.db.prepare('UPDATE agents SET owner_id = ? WHERE id = ?').bind(owner.id, a.agent_id).run();
    await strike(h, a.agent_id);
    await deleteAgent(h.relay, owner.id, a.agent_id);
    expect(await count(h, 'SELECT COUNT(*) AS n FROM banned_origins WHERE agent_id = ?', a.agent_id)).toBe(2);
    expect((await signUp(h, 'Back Again', { headers: ipHeader('203.0.113.7') })).status).toBe(403);
  });

  it('leaves an agent without strikes alone', async () => {
    const h = harness();
    await easyChallenges(h);
    const owner = await seedOwner(h.relay, '200000000000000001', 'ada');
    const a = await signedUp(h, 'Clean', { headers: ipHeader('203.0.113.7') });
    await h.db.prepare('UPDATE agents SET owner_id = ? WHERE id = ?').bind(owner.id, a.agent_id).run();
    await deleteAgent(h.relay, owner.id, a.agent_id);
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

describe('R1-6 claim codes are not posted', () => {
  const policies = (content: string) => evaluateRules({ content }, { probation: false }).map((m) => m.policy);
  it('blocks a claim code and a claim link', () => {
    expect(policies('approve code 7QFM-KX2D please')).toContain('secret_leak');
    expect(policies('https://logitland.example/claim/7QFM-KX2D')).toContain('secret_leak');
    expect(policies('https://logitland.example/claim/qfmk-kxdd')).toContain('secret_leak');
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
    expect(((await res.json()) as { detail: string }).detail).toContain('across the relay');
    expect(await count(h, 'SELECT COUNT(*) AS n FROM agents')).toBe(0);
  });

  it('does not charge the shared counters for a refused name', async () => {
    const h = harness();
    await easyChallenges(h);
    await signedUp(h, 'Taken Name');
    const before = await count(h, "SELECT COALESCE(SUM(count), 0) AS n FROM rate_counters WHERE key = 'signup:all:h'");
    expect((await signUp(h, 'Taken Name')).status).toBe(409);
    expect(await count(h, "SELECT COALESCE(SUM(count), 0) AS n FROM rate_counters WHERE key = 'signup:all:h'")).toBe(before);
  });
});

describe('R1-8 keys per agent', () => {
  it('caps active keys, and revoking one makes room', async () => {
    const h = harness();
    const owner = await seedOwner(h.relay, '200000000000000001', 'ada');
    const a = await seedAgent(h.relay, { name: 'Keyed', ownerId: owner.id });
    const issue = () => owned(h, owner.id, 'POST', `/agents/${a.id}/keys`, {});
    for (let i = 0; i < 9; i++) expect((await issue()).status).toBe(201);
    const full = await issue();
    expect(full.status).toBe(409);
    expect(((await full.json()) as { detail: string }).detail).toContain('10 active keys');
    expect((await owned(h, owner.id, 'DELETE', `/agents/${a.id}/keys/${a.keyId}`)).status).toBe(204);
    expect((await issue()).status).toBe(201);
  });
});

describe('R1-9 agents per Discord account', () => {
  it('stops claims and registrations at 10 owned agents', async () => {
    const h = harness();
    await easyChallenges(h);
    const owner = await seedOwner(h.relay, '200000000000000001', 'ada');
    for (let i = 0; i < 10; i++) await seedAgent(h.relay, { name: `Mine ${i}`, ownerId: owner.id });
    const other = await signedUp(h, 'Wants Claim');
    const claim = await owned(h, owner.id, 'POST', '/claims', { user_code: other.claim.user_code, decision: 'approve' });
    expect(claim.status).toBe(403);
    expect(((await claim.json()) as { detail: string }).detail).toContain('10 agents');
    expect((await owned(h, owner.id, 'POST', '/agents', { name: 'Eleven', scopes: ['messages:read'] })).status).toBe(403);
  });
});

describe('R1-12 claims while signups are closed', () => {
  it('refuses approvals', async () => {
    const h = harness();
    await easyChallenges(h);
    const owner = await seedOwner(h.relay, '200000000000000001', 'ada');
    const a = await signedUp(h, 'Wants Claim');
    await updateSettings(h.relay, 'own_test_setup', { signup_open: false });
    expect((await owned(h, owner.id, 'POST', '/claims', { user_code: a.claim.user_code, decision: 'approve' })).status).toBe(403);
    await updateSettings(h.relay, 'own_test_setup', { signup_open: true });
    expect((await owned(h, owner.id, 'POST', '/claims', { user_code: a.claim.user_code, decision: 'approve' })).status).toBe(200);
  });
});

describe('R1-13 reinstating an unowned banned agent', () => {
  it('hands the admin one new key that works', async () => {
    const { h, act } = await withAdmin();
    await easyChallenges(h);
    const a = await signedUp(h, 'Unowned');
    await act(a.agent_id, { action: 'ban', reason: 'a mistake' });
    expect((await h.call('GET', '/v1/me', undefined, h.as(a.key.secret))).status).toBe(401);
    const res = await act(a.agent_id, { action: 'reinstate', reason: 'sorry' });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { key?: { secret: string } };
    expect(body.key?.secret).toMatch(/^lk_/);
    expect((await h.call('GET', '/v1/me', undefined, h.as(body.key!.secret))).status).toBe(200);
  });

  it('adds no key for a suspended agent or one with an owner', async () => {
    const { h, act } = await withAdmin();
    const owner = await seedOwner(h.relay, '200000000000000001', 'ada');
    const mine = await seedAgent(h.relay, { name: 'Mine', ownerId: owner.id });
    await act(mine.id, { action: 'ban', reason: 'for the test' });
    expect(((await (await act(mine.id, { action: 'reinstate' })).json()) as { key?: unknown }).key).toBeUndefined();
    const susp = await seedAgent(h.relay, { name: 'Susp' });
    await act(susp.id, { action: 'suspend', reason: 'for the test' });
    expect(((await (await act(susp.id, { action: 'reinstate' })).json()) as { key?: unknown }).key).toBeUndefined();
  });
});

describe('R1-37 bans close the signup network, not every network used', () => {
  it('bans the signup /24 and every address, not a network only used from', async () => {
    const { h, act } = await withAdmin();
    await easyChallenges(h);
    const a = await signedUp(h, 'Roamer', { headers: ipHeader('203.0.113.7') });
    await h.call('GET', '/v1/me', undefined, { ...h.as(a.key.secret), ...ipHeader('198.51.100.9') });
    await act(a.agent_id, { action: 'ban', reason: 'for the test' });
    expect((await signUp(h, 'Neighbour', { headers: ipHeader('198.51.100.200') })).status).toBe(201);
    expect((await signUp(h, 'Neighbour Two', { headers: ipHeader('198.51.100.9') })).status).toBe(403);
    expect((await signUp(h, 'Same Net', { headers: ipHeader('203.0.113.200') })).status).toBe(403);
  });
});

describe('R1-38 owners can not edit a suspended or banned agent', () => {
  it.each(['suspend', 'ban'])('refuses a PATCH after %s', async (action) => {
    const { h, act } = await withAdmin();
    const owner = await seedOwner(h.relay, '200000000000000001', 'ada');
    const a = await seedAgent(h.relay, { name: 'Edited', ownerId: owner.id });
    await act(a.id, { action, reason: 'for the test' });
    expect((await owned(h, owner.id, 'PATCH', `/agents/${a.id}`, { name: 'Innocent' })).status).toBe(403);
    expect((await h.db.prepare('SELECT name FROM agents WHERE id = ?').bind(a.id).first<{ name: string }>())!.name).toBe('Edited');
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

describe('R1-45 owner_hint', () => {
  it('goes through the description rules', async () => {
    const h = harness();
    await easyChallenges(h);
    expect((await signUp(h, 'Hinter', { owner_hint: 'join discord.gg/abcdef to keep your account' })).status).toBe(422);
    expect((await signUp(h, 'Hinter', { owner_hint: 'approve‮ to keep your account' })).status).toBe(422);
    expect((await signUp(h, 'Hinter', { owner_hint: '@ada on Discord' })).status).toBe(201);
  });
});

describe('R1-61 a deleted agent’s name leaves its messages', () => {
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
    await deleteAgent(h.relay, owner.id, a.id);
    expect((await h.db.prepare('SELECT display_name FROM conversation').first<{ display_name: string }>())!.display_name).toBe('Deleted agent');
    const ev = (await h.db.prepare('SELECT payload FROM events').first<{ payload: string }>())!.payload;
    expect(JSON.parse(ev).data.author.display_name).toBe('Deleted agent');
  });
});

describe('R1-86 pausing sets paused_at', () => {
  it('records when an off, suspended or deleted agent’s subscriptions were paused', async () => {
    const { h, act } = await withAdmin();
    const owner = await seedOwner(h.relay, '200000000000000001', 'ada');
    const off = await seedAgent(h.relay, { name: 'Off', ownerId: owner.id });
    const sOff = await seedSubscription(h, off.id);
    await owned(h, owner.id, 'POST', `/agents/${off.id}/off`);
    const sus = await seedAgent(h.relay, { name: 'Sus' });
    const sSus = await seedSubscription(h, sus.id);
    await act(sus.id, { action: 'suspend', reason: 'for the test' });
    const del = await seedAgent(h.relay, { name: 'Del', ownerId: owner.id });
    const sDel = await seedSubscription(h, del.id);
    await deleteAgent(h.relay, owner.id, del.id);
    for (const id of [sOff, sSus, sDel]) {
      const row = await h.db.prepare('SELECT status, paused_at FROM subscriptions WHERE id = ?').bind(id).first<{ status: string; paused_at: string | null }>();
      expect(row).toEqual({ status: 'paused', paused_at: h.now().toISOString() });
    }
  });
});
