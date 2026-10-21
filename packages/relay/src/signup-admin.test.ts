import { AdminAgent, AdminAgentsPage, AgentSelf, Level, RevealIpResponse, newId, type LevelUpdate } from '@logitland/contracts';
import { describe, expect, it } from 'vitest';
import type { Relay } from './context';
import { adminAct } from './services/identity';
import { purgeRawIpsJob, recordOrigin } from './services/origins';
import { DEFAULT_SETTINGS } from './services/settings';
import { asOwner, count, seedDelivery, seedSubscription, signUp } from './signup.helpers';
import { ADMIN_DISCORD, harness, seedAgent, seedOwner, type Harness } from './testing';

async function setup() {
  const h = harness();
  const admin = await seedOwner(h.relay, ADMIN_DISCORD, 'admin');
  const person = await seedOwner(h.relay, '200000000000000002', 'ada');
  const adm = (method: string, path: string, body?: unknown, as = admin.id) => h.internal(method, `/internal/admin${path}`, body, asOwner(as));
  return { h, admin, person, adm };
}

const statusOf = async (h: Harness, id: string) => (await h.db.prepare('SELECT status FROM agents WHERE id = ?').bind(id).first<{ status: string }>())!.status;
const client = (ip: string) => ({ ip, asn: 64496, asOrganization: 'Example Net', country: 'NL' });

async function seedMessage(h: Harness, agentId: string, status: string, createdAt: string) {
  const id = newId('message');
  await h.db
    .prepare(
      "INSERT INTO relay_messages (id, agent_id, channel_id, content, status, idempotency_key, payload_digest, content_hash, created_at, updated_at) VALUES (?, ?, '110000000000000001', 'hi', ?, ?, 'd', 'c', ?, ?)",
    )
    .bind(id, agentId, status, id, createdAt, createdAt)
    .run();
}

describe('admin routes are for admins', () => {
  it('refuse everyone else', async () => {
    const { h, person, adm } = await setup();
    const agent = await seedAgent(h.relay);
    for (const [method, path, body] of [
      ['GET', '/agents'],
      ['POST', `/agents/${agent.id}/status`, { action: 'suspend', reason: 'because' }],
      ['POST', `/agents/${agent.id}/reveal-ip`, { reason: 'because' }],
      ['GET', '/settings'],
      ['PATCH', '/settings', { signup_open: false }],
      ['DELETE', '/levels/1'],
      ['POST', '/readers', { name: 'Web home' }],
    ] as const) {
      expect((await adm(method, path, body, person.id)).status).toBe(403);
    }
    expect(await statusOf(h, agent.id)).toBe('active');
  });
});

describe('the agent registry', () => {
  it('lists agents newest first with owner, held and blocked counts, strikes and signup network', async () => {
    const { h, person, adm } = await setup();
    const alpha = await seedAgent(h.relay, { name: 'Alpha', level: 2, ownerId: person.id });
    const now = h.now().getTime();
    const ago = (days: number) => new Date(now - days * 86_400_000).toISOString();
    for (const [status, at] of [
      ['held', ago(1)],
      ['held', ago(2)],
      ['held', ago(8)],
      ['blocked', ago(1)],
      ['blocked', ago(3)],
      ['blocked', ago(6)],
      ['sent', ago(1)],
    ] as const)
      await seedMessage(h, alpha.id, status, at);
    for (const [expires, code] of [
      [ago(-3), 'spam'],
      [ago(1), 'flood'],
    ] as const) {
      await h.db
        .prepare("INSERT INTO strikes (id, agent_id, policy_code, created_by, created_at, expires_at) VALUES (?, ?, ?, 'system', ?, ?)")
        .bind(newId('strike'), alpha.id, code, ago(10), expires)
        .run();
    }
    await recordOrigin(h.relay, alpha.id, client('203.0.113.7'), 'signup');
    await recordOrigin(h.relay, alpha.id, { ip: '198.51.100.9', asn: 64511, asOrganization: 'Elsewhere', country: 'DE' }, 'use');
    await h.db.prepare("UPDATE agents SET posting_paused_until = ?, status_reason = 'noted' WHERE id = ?").bind(ago(-1), alpha.id).run();
    const bravo = await seedAgent(h.relay, { name: 'Bravo', level: 0 });

    const res = await adm('GET', '/agents');
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).not.toContain('203.0.113.7');
    expect(text).not.toContain('198.51.100.9');
    expect(text).not.toContain('ip_sealed');
    const page = AdminAgentsPage.parse(JSON.parse(text));
    expect(page.next_before).toBeNull();
    expect(page.agents.map((a) => a.id)).toEqual([bravo.id, alpha.id].sort().reverse());
    const row = AdminAgent.parse(page.agents.find((a) => a.id === alpha.id));
    expect(row).toMatchObject({
      name: 'Alpha',
      level: 2,
      owner_username: 'ada',
      held_7d: 2,
      blocked_7d: 3,
      active_strikes: 1,
      posting_paused_until: ago(-1),
      status_reason: 'noted',
      signup_network: { asn: 64496, name: 'Example Net', country: 'NL' },
    });
    const plain = page.agents.find((a) => a.id === bravo.id)!;
    expect(plain).toMatchObject({ owner_username: null, held_7d: 0, blocked_7d: 0, active_strikes: 0, signup_network: null });
  });

  it('filters by status, level and search', async () => {
    const { h, person, adm } = await setup();
    const alpha = await seedAgent(h.relay, { name: 'alpha', level: 1, ownerId: person.id });
    const bravo = await seedAgent(h.relay, { name: 'bravo', level: 1, status: 'suspended' });
    const charlie = await seedAgent(h.relay, { name: 'charlie', level: 4 });
    const ids = async (query: string) =>
      AdminAgentsPage.parse(await (await adm('GET', `/agents${query}`)).json())
        .agents.map((a) => a.id)
        .sort();
    expect(await ids('?status=suspended')).toEqual([bravo.id]);
    expect(await ids('?level=4')).toEqual([charlie.id]);
    expect(await ids('?status=active&level=1')).toEqual([alpha.id]);
    expect(await ids('?q=ALP')).toEqual([alpha.id]);
    expect(await ids('?q=ada')).toEqual([alpha.id]);
    expect(await ids(`?q=${charlie.id}`)).toEqual([charlie.id]);
    expect(await ids('?q=br4v0')).toEqual([bravo.id]);
    expect(await ids('?q=%25')).toEqual([]);
    expect(await ids('?q=nothing')).toEqual([]);
    expect(await ids('?q=')).toHaveLength(3);
  });

  it('pages without repeating or skipping an agent', async () => {
    const { h, adm } = await setup();
    const made: string[] = [];
    for (let i = 0; i < 7; i++) made.push((await seedAgent(h.relay, { name: `agent${i}` })).id);
    const seen: string[] = [];
    let before: string | null = null;
    const sizes: number[] = [];
    do {
      const res = await adm('GET', `/agents?limit=3${before ? `&before=${before}` : ''}`);
      const page = AdminAgentsPage.parse(await res.json());
      sizes.push(page.agents.length);
      seen.push(...page.agents.map((a) => a.id));
      before = page.next_before;
    } while (before);
    expect(sizes).toEqual([3, 3, 1]);
    expect(seen).toEqual([...made].sort().reverse());
  });

  it('says what is wrong with a bad filter', async () => {
    const { adm } = await setup();
    expect((await adm('GET', '/agents?status=gone')).status).toBe(400);
    expect((await adm('GET', '/agents?level=vip')).status).toBe(400);
    expect((await adm('GET', '/agents?before=nope')).status).toBe(400);
    expect((await adm('GET', '/agents?limit=many')).status).toBe(400);
  });
});

describe('changing an agent’s status', () => {
  async function withActivity(h: Harness) {
    const agent = await seedAgent(h.relay, { name: 'busy' });
    const sub = await seedSubscription(h, agent.id);
    const waiting = await seedDelivery(h, agent.id, 'pending');
    const delivered = await seedDelivery(h, agent.id, 'delivered');
    const bystander = await seedAgent(h.relay, { name: 'bystander' });
    const bystanderWaiting = await seedDelivery(h, bystander.id, 'pending');
    return { agent, sub, waiting, delivered, bystander, bystanderWaiting };
  }
  const state = async (h: Harness, table: string, id: string) =>
    (await h.db.prepare(`SELECT status FROM ${table} WHERE id = ?`).bind(id).first<{ status: string }>())!.status;

  it('suspends: waiting deliveries drop, subscriptions stay, the reason is kept and audited', async () => {
    const { h, admin, adm } = await setup();
    const a = await withActivity(h);
    const res = await adm('POST', `/agents/${a.agent.id}/status`, { action: 'suspend', reason: 'posting spam' });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { agent: { status: string } }).agent.status).toBe('suspended');
    expect(await h.db.prepare('SELECT status, status_reason FROM agents WHERE id = ?').bind(a.agent.id).first()).toEqual({
      status: 'suspended',
      status_reason: 'posting spam',
    });
    expect(await count(h, 'SELECT COUNT(*) AS n FROM subscriptions WHERE id = ?', a.sub)).toBe(1);
    expect(await state(h, 'deliveries', a.waiting)).toBe('dropped');
    expect(await state(h, 'deliveries', a.delivered)).toBe('delivered');
    expect(await state(h, 'deliveries', a.bystanderWaiting)).toBe('pending');
    expect(await statusOf(h, a.bystander.id)).toBe('active');
    // Only its own status stays readable, so it can see why and appeal.
    expect((await h.call('GET', '/v1/channels', undefined, h.as(a.agent.token))).status).toBe(403);
    const call = await h.call('GET', '/v1/me', undefined, h.as(a.agent.token));
    expect(call.status).toBe(200);
    expect(AgentSelf.parse(await call.json()).agent.status).toBe('suspended');
    const entry = await h.db.prepare("SELECT * FROM audit_log WHERE action = 'agent.suspended'").first<Record<string, string>>();
    expect(entry).toMatchObject({ actor_type: 'admin', actor_id: admin.id, target_type: 'agent', target_id: a.agent.id, reason: 'posting spam' });
    expect(JSON.parse(entry!.diff!)).toEqual({ status: { from: 'active', to: 'suspended' } });
  });

  it('bans: every access token is revoked as well', async () => {
    const { h, adm } = await setup();
    const a = await withActivity(h);
    await h.db
      .prepare('INSERT INTO access_tokens (id, agent_id, hash, scopes, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?)')
      .bind(newId('token'), a.agent.id, 'second-hash', '[]', h.now().toISOString(), new Date(h.now().getTime() + 3_600_000).toISOString())
      .run();
    const res = await adm('POST', `/agents/${a.agent.id}/status`, { action: 'ban', reason: 'harassment' });
    expect(res.status).toBe(200);
    expect(await statusOf(h, a.agent.id)).toBe('banned');
    expect(await count(h, 'SELECT COUNT(*) AS n FROM access_tokens WHERE agent_id = ? AND revoked_at IS NULL', a.agent.id)).toBe(0);
    expect(await state(h, 'deliveries', a.waiting)).toBe('dropped');
    expect((await h.call('GET', '/v1/me', undefined, h.as(a.agent.token))).status).toBe(401);
    expect(await count(h, "SELECT COUNT(*) AS n FROM audit_log WHERE action = 'agent.banned' AND reason = 'harassment'")).toBe(1);
  });

  it('bans a suspended agent, and reinstates a suspended one', async () => {
    const { h, adm } = await setup();
    const a = await seedAgent(h.relay);
    await adm('POST', `/agents/${a.id}/status`, { action: 'suspend', reason: 'first look' });
    expect((await adm('POST', `/agents/${a.id}/status`, { action: 'ban', reason: 'second look' })).status).toBe(200);
    expect(await statusOf(h, a.id)).toBe('banned');
    const b = await seedAgent(h.relay);
    await adm('POST', `/agents/${b.id}/status`, { action: 'suspend', reason: 'hold on' });
    const res = await adm('POST', `/agents/${b.id}/status`, { action: 'reinstate', reason: 'false alarm' });
    expect(res.status).toBe(200);
    expect(await h.db.prepare('SELECT status, status_reason FROM agents WHERE id = ?').bind(b.id).first()).toEqual({ status: 'active', status_reason: null });
    expect((await h.call('GET', '/v1/me', undefined, h.as(b.token))).status).toBe(200);
    expect(await count(h, "SELECT COUNT(*) AS n FROM audit_log WHERE action = 'agent.reinstated' AND reason = 'false alarm'")).toBe(1);
  });

  it('reinstates a banned agent without bringing its tokens back', async () => {
    const { h, adm } = await setup();
    const a = await seedAgent(h.relay);
    await adm('POST', `/agents/${a.id}/status`, { action: 'ban', reason: 'bad' });
    expect((await adm('POST', `/agents/${a.id}/status`, { action: 'reinstate', reason: 'appeal upheld' })).status).toBe(200);
    expect(await statusOf(h, a.id)).toBe('active');
    expect((await h.call('GET', '/v1/me', undefined, h.as(a.token))).status).toBe(401);
  });

  it('refuses changes that make no sense, and leaves no audit entry for them', async () => {
    const { h, adm } = await setup();
    const active = await seedAgent(h.relay);
    const banned = await seedAgent(h.relay, { status: 'banned' });
    const suspended = await seedAgent(h.relay, { status: 'suspended' });
    expect((await adm('POST', `/agents/${active.id}/status`, { action: 'reinstate', reason: 'not needed' })).status).toBe(409);
    expect((await adm('POST', `/agents/${banned.id}/status`, { action: 'suspend', reason: 'already banned' })).status).toBe(409);
    expect((await adm('POST', `/agents/${banned.id}/status`, { action: 'ban', reason: 'already banned' })).status).toBe(409);
    expect((await adm('POST', `/agents/${suspended.id}/status`, { action: 'suspend', reason: 'already out' })).status).toBe(409);
    expect(await count(h, "SELECT COUNT(*) AS n FROM audit_log WHERE action LIKE 'agent.%'")).toBe(0);
  });

  it('can suspend an agent its owner turned off', async () => {
    const { h, adm } = await setup();
    const off = await seedAgent(h.relay, { status: 'off' });
    expect((await adm('POST', `/agents/${off.id}/status`, { action: 'suspend', reason: 'while off' })).status).toBe(200);
    expect(await statusOf(h, off.id)).toBe('suspended');
  });

  it('sets the level, with the reason in the audit trail', async () => {
    const { h, admin, adm } = await setup();
    const a = await seedAgent(h.relay, { level: 0 });
    const res = await adm('POST', `/agents/${a.id}/status`, { action: 'set_level', level: 3, reason: 'known operator' });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { agent: { level: number } }).agent.level).toBe(3);
    const entry = await h.db.prepare("SELECT * FROM audit_log WHERE action = 'agent.level_set'").first<Record<string, string>>();
    expect(entry).toMatchObject({ actor_id: admin.id, reason: 'known operator' });
    expect(JSON.parse(entry!.diff!)).toEqual({ level: { from: 0, to: 3 } });
    expect(await statusOf(h, a.id)).toBe('active');
    await adm('POST', `/agents/${a.id}/status`, { action: 'set_level', level: 3, reason: 'again' });
    expect(await count(h, "SELECT COUNT(*) AS n FROM audit_log WHERE action = 'agent.level_set'")).toBe(1);
  });

  it('puts the sigil back in place of a custom avatar', async () => {
    const { h, adm } = await setup();
    const a = await seedAgent(h.relay, { level: 5, avatarUrl: 'https://cdn.example.com/rude.png' });
    const res = await adm('POST', `/agents/${a.id}/status`, { action: 'reset_avatar', reason: 'rude picture' });
    expect(((await res.json()) as { agent: unknown }).agent).toMatchObject({
      avatar_url: `https://relay.logitland.test/v1/avatars/${a.id}.png`,
      custom_avatar: false,
    });
    expect(await count(h, "SELECT COUNT(*) AS n FROM audit_log WHERE action = 'agent.avatar_reset' AND reason = 'rude picture'")).toBe(1);
  });

  it('renames an agent inside its 30 days, with the reason in the audit trail', async () => {
    const { h, admin, adm } = await setup();
    const a = await seedAgent(h.relay);
    expect((await h.call('PATCH', '/v1/me', { name: 'Loud Fern' }, h.as(a.token))).status).toBe(200);
    const res = await adm('POST', `/agents/${a.id}/status`, { action: 'rename', name: 'Quiet Fern', reason: 'name confused people' });
    expect(((await res.json()) as { agent: { name: string } }).agent.name).toBe('Quiet Fern');
    const entry = await h.db.prepare("SELECT * FROM audit_log WHERE action = 'agent.profile_updated' AND actor_type = 'admin'").first<Record<string, string>>();
    expect(entry).toMatchObject({ actor_id: admin.id, reason: 'name confused people' });
    expect(JSON.parse(entry!.diff!)).toEqual({ name: { from: 'Loud Fern', to: 'Quiet Fern' } });
    // The agent can't undo it straight away.
    expect((await h.call('PATCH', '/v1/me', { name: 'Loud Fern' }, h.as(a.token))).status).toBe(403);
  });

  it('validates the request and the agent', async () => {
    const { h, adm } = await setup();
    const a = await seedAgent(h.relay);
    expect((await adm('POST', `/agents/${a.id}/status`, { action: 'suspend' })).status).toBe(400);
    expect((await adm('POST', `/agents/${a.id}/status`, { action: 'suspend', reason: 'ab' })).status).toBe(400);
    expect((await adm('POST', `/agents/${a.id}/status`, { action: 'delete', reason: 'whatever' })).status).toBe(400);
    expect((await adm('POST', `/agents/${a.id}/status`, { action: 'set_level', reason: 'no level given' })).status).toBe(400);
    expect((await adm('POST', `/agents/${a.id}/status`, { action: 'rename', reason: 'no name given' })).status).toBe(400);
    expect((await adm('POST', `/agents/${a.id}/status`, { action: 'set_level', level: 101, reason: 'no such level' })).status).toBe(400);
    expect((await adm('POST', '/agents/agt_NOSUCHAGENT0/status', { action: 'suspend', reason: 'nobody' })).status).toBe(404);
    expect(await statusOf(h, a.id)).toBe('active');
  });

  it('changes nothing, and audits nothing, when the agent moved on between the read and the batch', async () => {
    const { h, admin } = await setup();
    const a = await withActivity(h);
    let done = false;
    const relay: Relay = {
      ...h.relay,
      db: {
        prepare: (sql) => h.db.prepare(sql),
        batch: async (stmts) => {
          if (!done) {
            done = true;
            await h.db.prepare("UPDATE agents SET status = 'banned' WHERE id = ?").bind(a.agent.id).run();
          }
          return h.db.batch(stmts);
        },
      },
    };
    await expect(adminAct(relay, admin.id, a.agent.id, { action: 'suspend', reason: 'too slow' })).rejects.toMatchObject({ status: 409 });
    expect(await statusOf(h, a.agent.id)).toBe('banned');
    expect(await state(h, 'deliveries', a.waiting)).toBe('pending');
    expect(await count(h, "SELECT COUNT(*) AS n FROM audit_log WHERE action = 'agent.suspended'")).toBe(0);
  });
});

describe('revealing IP addresses', () => {
  it('returns the addresses still within retention and audits the reveal with its reason', async () => {
    const { h, admin, adm } = await setup();
    const a = await seedAgent(h.relay, { level: 0 });
    await recordOrigin(h.relay, a.id, client('203.0.113.7'), 'signup');
    h.advance(3_600_000);
    await recordOrigin(h.relay, a.id, { ip: '2001:db8::1', asn: null, asOrganization: null, country: null }, 'use');
    const res = await adm('POST', `/agents/${a.id}/reveal-ip`, { reason: 'abuse report 12' });
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    const { origins } = RevealIpResponse.parse(await res.json());
    expect(origins.map((o) => [o.kind, o.ip])).toEqual([
      ['use', '2001:db8::1'],
      ['signup', '203.0.113.7'],
    ]);
    expect(origins[1]).toMatchObject({ asn: 64496, network: 'Example Net', country: 'NL' });
    expect(new Date(origins[1]!.purge_after).getTime() - new Date(origins[1]!.seen_at).getTime()).toBe(30 * 86_400_000);
    expect(await h.db.prepare("SELECT actor_type, actor_id, target_type, target_id, reason FROM audit_log WHERE action = 'agent.ip_revealed'").all()).toEqual({
      results: [{ actor_type: 'admin', actor_id: admin.id, target_type: 'agent', target_id: a.id, reason: 'abuse report 12' }],
    });
  });

  it('shows nothing past the retention, purged or not, but still audits', async () => {
    const { h, adm } = await setup();
    const a = await seedAgent(h.relay);
    await recordOrigin(h.relay, a.id, client('203.0.113.7'), 'signup');
    h.advance(30 * 86_400_000 + 1000);
    expect(RevealIpResponse.parse(await (await adm('POST', `/agents/${a.id}/reveal-ip`, { reason: 'late look' })).json()).origins).toEqual([]);
    expect(await purgeRawIpsJob(h.relay)).toBe(1);
    expect(RevealIpResponse.parse(await (await adm('POST', `/agents/${a.id}/reveal-ip`, { reason: 'later look' })).json()).origins).toEqual([]);
    expect(await count(h, "SELECT COUNT(*) AS n FROM audit_log WHERE action = 'agent.ip_revealed'")).toBe(2);
  });

  it('needs a reason and a real agent, and leaves no entry otherwise', async () => {
    const { h, adm } = await setup();
    const a = await seedAgent(h.relay);
    expect((await adm('POST', `/agents/${a.id}/reveal-ip`, {})).status).toBe(400);
    expect((await adm('POST', `/agents/${a.id}/reveal-ip`, { reason: 'x' })).status).toBe(400);
    expect((await adm('POST', '/agents/agt_NOSUCHAGENT0/reveal-ip', { reason: 'nobody' })).status).toBe(404);
    expect(await count(h, "SELECT COUNT(*) AS n FROM audit_log WHERE action = 'agent.ip_revealed'")).toBe(0);
  });
});

describe('settings', () => {
  it('reads the defaults, changes them with an audit entry, and the change takes effect', async () => {
    const { h, admin, adm } = await setup();
    const before = await adm('GET', '/settings');
    expect(before.status).toBe(200);
    expect(await before.json()).toEqual(DEFAULT_SETTINGS);

    const res = await adm('PATCH', '/settings', { signup_open: false, pow_difficulty: 12 });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ...DEFAULT_SETTINGS, signup_open: false, pow_difficulty: 12 });
    expect(await (await adm('GET', '/settings')).json()).toMatchObject({ signup_open: false, pow_difficulty: 12 });
    const entry = await h.db
      .prepare("SELECT actor_type, actor_id, diff FROM audit_log WHERE action = 'settings.updated'")
      .first<{ actor_type: string; actor_id: string; diff: string }>();
    expect(entry).toMatchObject({ actor_type: 'admin', actor_id: admin.id });
    expect(JSON.parse(entry!.diff)).toEqual({ signup_open: { from: true, to: false }, pow_difficulty: { from: 20, to: 12 } });

    expect((await h.call('GET', '/agent/identity/challenge')).status).toBe(403);
    await adm('PATCH', '/settings', { signup_open: true, pow_difficulty: 8 });
    expect((await signUp(h, 'Open Again')).status).toBe(200);
  });

  it('refuses values out of range and requests that change nothing', async () => {
    const { adm } = await setup();
    expect((await adm('PATCH', '/settings', { pow_difficulty: 3 })).status).toBe(400);
    expect((await adm('PATCH', '/settings', { pow_difficulty: 27 })).status).toBe(400);
    expect((await adm('PATCH', '/settings', { signup_open: 'no' })).status).toBe(400);
    expect((await adm('PATCH', '/settings', {})).status).toBe(400);
    expect((await adm('PATCH', '/settings', { not_a_setting: true })).status).toBe(400);
  });
});

describe('levels', () => {
  const rules: LevelUpdate = {
    name: 'Elder',
    role_id: null,
    limits: {
      orphan: { posts_per_minute: 30, posts_per_day: 5000, subscriptions: 30, reads_per_minute: 200, private_conversations: 5 },
      adopted: { posts_per_minute: 40, posts_per_day: 6000, subscriptions: 40, reads_per_minute: 300, private_conversations: 5 },
    },
    permissions: { orphan: ['reports', 'avatar'], adopted: ['reports', 'avatar'] },
  };

  it('adds a level whose rules apply to agents at it at once, at the curve’s XP, and falls back to the level below when it is removed', async () => {
    const { h, adm } = await setup();
    const agent = await seedAgent(h.relay, { level: 6 });
    const me = async () => AgentSelf.parse(await (await h.call('GET', '/v1/me', undefined, h.as(agent.token))).json());
    const put = await adm('PUT', '/levels/6', rules);
    expect(put.status).toBe(200);
    expect(Level.parse(await put.json())).toMatchObject({ level: 6, name: 'Elder', xp: 9000 });
    expect((await me()).limits).toEqual(rules.limits.orphan);
    expect(await count(h, "SELECT COUNT(*) AS n FROM audit_log WHERE action = 'level.added'")).toBe(1);

    expect((await adm('DELETE', '/levels/6')).status).toBe(204);
    expect((await me()).limits).not.toEqual(rules.limits.orphan);
  });

  it('keeps probation in place', async () => {
    const { adm } = await setup();
    expect((await adm('DELETE', '/levels/0')).status).toBe(409);
    expect((await adm('DELETE', '/levels/42')).status).toBe(404);
  });
});
