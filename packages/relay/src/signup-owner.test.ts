import { AgentSelf, CreatedAgent, IssuedKey, LIMITS, OwnerAgentDetail, OwnerSession, PolicyProblem } from '@logitland/contracts';
import { describe, expect, it } from 'vitest';
import type { Moderator } from './services/moderation/classifier';
import { ADMIN_DISCORD, harness, seedAgent, seedOwner, type Harness } from './testing';
import { hit } from './services/limits';
import { updateSettings } from './services/settings';
import { asOwner, count, seedDelivery, seedSubscription } from './signup.helpers';

const owned = (h: Harness, ownerId: string, method: string, path: string, body?: unknown) =>
  h.internal(method, `/internal/owners/${ownerId}${path}`, body, asOwner(ownerId));

async function setup() {
  const h = harness();
  const owner = await seedOwner(h.relay, '200000000000000001', 'ada');
  const other = await seedOwner(h.relay, '200000000000000002', 'grace');
  return { h, owner, other };
}

async function createAgent(h: Harness, ownerId: string, over: Record<string, unknown> = {}) {
  const res = await owned(h, ownerId, 'POST', '/agents', { name: 'Ada Bot', scopes: ['messages:read', 'messages:write'], key_label: 'laptop', ...over });
  expect(res.status).toBe(201);
  return CreatedAgent.parse(await res.json());
}

describe('owner sign-in', () => {
  it('creates the owner on first sign-in and updates the username after', async () => {
    const h = harness();
    const first = await h.internal('POST', '/internal/owners', { discord_user_id: '200000000000000007', username: 'ada' });
    expect(first.status).toBe(200);
    const a = OwnerSession.parse(await first.json());
    expect(a).toMatchObject({ is_admin: false, owner: { discord_user_id: '200000000000000007', username: 'ada' } });
    const again = OwnerSession.parse(await (await h.internal('POST', '/internal/owners', { discord_user_id: '200000000000000007', username: 'ada.l' })).json());
    expect(again.owner).toMatchObject({ id: a.owner.id, username: 'ada.l', created_at: a.owner.created_at });
    expect(await count(h, 'SELECT COUNT(*) AS n FROM owners')).toBe(1);
  });

  it('marks the configured Discord IDs as admins', async () => {
    const h = harness();
    expect(OwnerSession.parse(await (await h.internal('POST', '/internal/owners', { discord_user_id: ADMIN_DISCORD, username: 'boss' })).json()).is_admin).toBe(
      true,
    );
  });

  it('needs the dashboard token and a valid body', async () => {
    const h = harness();
    expect(
      (await h.internal('POST', '/internal/owners', { discord_user_id: '200000000000000007', username: 'ada' }, { 'x-logitland-internal': 'wrong' })).status,
    ).toBe(401);
    expect((await h.internal('POST', '/internal/owners', { discord_user_id: 'abc', username: 'ada' })).status).toBe(400);
    expect((await h.internal('POST', '/internal/owners', { discord_user_id: '200000000000000007', username: '' })).status).toBe(400);
  });
});

describe('registering an agent from the dashboard', () => {
  it('creates a claimed agent with its first key, on probation like any other agent', async () => {
    const { h, owner } = await setup();
    const { agent, key } = await createAgent(h, owner.id, { description: 'Does things' });
    expect(agent).toMatchObject({
      owner_id: owner.id,
      name: 'Ada Bot',
      tier: 'claimed',
      status: 'active',
      created_via: 'dashboard',
      description: 'Does things',
      avatar_url: null,
      scopes: ['messages:read', 'messages:write'],
    });
    expect(IssuedKey.parse(key)).toMatchObject({ label: 'laptop', scopes: ['messages:read', 'messages:write'], agent_id: agent.id, revoked_at: null });
    const me = AgentSelf.parse(await (await h.call('GET', '/v1/me', undefined, h.as(key.secret))).json());
    expect(me.agent.claimed).toBe(true);
    expect(me.probation).toEqual({ until: new Date(h.now().getTime() + LIMITS.probationHours * 3_600_000).toISOString(), posts_left: LIMITS.probationPosts });
    expect(me.scopes).toEqual(['messages:read', 'messages:write']);
    expect(await h.db.prepare('SELECT kind FROM agent_origins WHERE agent_id = ?').bind(agent.id).first()).toEqual({ kind: 'signup' });
    expect(await h.db.prepare("SELECT actor_type, actor_id FROM audit_log WHERE action = 'agent.created'").first()).toEqual({
      actor_type: 'owner',
      actor_id: owner.id,
    });
  });

  it('drops repeated scopes and takes the first key’s label from key_label', async () => {
    const { h, owner } = await setup();
    const { agent, key } = await createAgent(h, owner.id, { scopes: ['messages:read', 'messages:read'], key_label: undefined });
    expect(agent.scopes).toEqual(['messages:read']);
    expect(key.label).toBeNull();
  });

  it('applies the name rules and uniqueness', async () => {
    const { h, owner, other } = await setup();
    await createAgent(h, owner.id, { name: 'Taken Bot' });
    expect((await owned(h, other.id, 'POST', '/agents', { name: 'taken-bot', scopes: ['messages:read'] })).status).toBe(409);
    const reserved = await owned(h, other.id, 'POST', '/agents', { name: 'Official Staff', scopes: ['messages:read'] });
    expect(reserved.status).toBe(422);
    expect(PolicyProblem.parse(await reserved.json()).policy_code).toBe('impersonation');
    expect(await count(h, 'SELECT COUNT(*) AS n FROM agents')).toBe(1);
  });

  it('moderates the name and description', async () => {
    const block: Moderator = { review: async (req) => (req.content.includes('Rude') ? { verdict: 'block', policy_code: 'harassment' } : { verdict: 'pass' }) };
    const h = harness({ moderator: block });
    const owner = await seedOwner(h.relay);
    const res = await owned(h, owner.id, 'POST', '/agents', { name: 'Rude Bot', scopes: ['messages:read'] });
    expect(res.status).toBe(422);
    expect(PolicyProblem.parse(await res.json()).policy_code).toBe('harassment');
    expect((await owned(h, owner.id, 'POST', '/agents', { name: 'Kind Bot', description: 'Rude things', scopes: ['messages:read'] })).status).toBe(422);
    expect(await count(h, 'SELECT COUNT(*) AS n FROM agents')).toBe(0);
    expect(await count(h, "SELECT COUNT(*) AS n FROM moderation_log WHERE layer = 'admission'")).toBe(3);
  });

  it('needs at least one scope', async () => {
    const { h, owner } = await setup();
    expect((await owned(h, owner.id, 'POST', '/agents', { name: 'No Scopes', scopes: [] })).status).toBe(400);
  });

  it('limits an owner to 10 registrations an hour', async () => {
    const { h, owner } = await setup();
    for (let i = 0; i < 10; i++) await createAgent(h, owner.id, { name: `Bulk Agent ${String.fromCharCode(97 + i)}` });
    expect((await owned(h, owner.id, 'POST', '/agents', { name: 'Bulk Agent z', scopes: ['messages:read'] })).status).toBe(429);
  });

  it('limits all owners together', async () => {
    const { h } = await setup();
    await hit(h.relay, { key: 'agent-create:all:h', limit: LIMITS.dashboardAgentsPerHour, windowSeconds: 3600 }, LIMITS.dashboardAgentsPerHour);
    const fresh = await seedOwner(h.relay, '200000000000000003', 'newcomer');
    const res = await owned(h, fresh.id, 'POST', '/agents', { name: 'One Too Many', scopes: ['messages:read'] });
    expect(res.status).toBe(429);
    expect(Number(res.headers.get('retry-after'))).toBeGreaterThan(0);
    expect(await count(h, 'SELECT COUNT(*) AS n FROM agents')).toBe(0);
  });

  it('is closed while signups are closed', async () => {
    const { h, owner } = await setup();
    await updateSettings(h.relay, 'own_test_setup', { signup_open: false });
    const res = await owned(h, owner.id, 'POST', '/agents', { name: 'Closed Bot', scopes: ['messages:read'] });
    expect(res.status).toBe(403);
    await updateSettings(h.relay, 'own_test_setup', { signup_open: true });
    expect((await owned(h, owner.id, 'POST', '/agents', { name: 'Closed Bot', scopes: ['messages:read'] })).status).toBe(201);
  });

  it('needs a Discord account at least a week old, counted from its snowflake', async () => {
    const h = harness();
    const idCreatedAt = (ms: number) => String((BigInt(ms) - 1_420_070_400_000n) << 22n);
    const young = await seedOwner(h.relay, idCreatedAt(h.now().getTime() - 6 * 86_400_000), 'fresh');
    const res = await owned(h, young.id, 'POST', '/agents', { name: 'Young Bot', scopes: ['messages:read'] });
    expect(res.status).toBe(403);
    const detail = (await res.json()).detail as string;
    expect(detail).toContain('7 days');
    expect(detail).toContain(new Date(h.now().getTime() + 86_400_000).toISOString().slice(0, 10));
    expect(await count(h, 'SELECT COUNT(*) AS n FROM agents')).toBe(0);
    h.advance(86_400_000 + 1000);
    expect((await owned(h, young.id, 'POST', '/agents', { name: 'Young Bot', scopes: ['messages:read'] })).status).toBe(201);
  });

  it('runs the fixed message rules over the name and description', async () => {
    const { h, owner } = await setup();
    const res = await owned(h, owner.id, 'POST', '/agents', { name: 'Fine Bot', description: 'Join discord.gg/abcdef', scopes: ['messages:read'] });
    expect(res.status).toBe(422);
    expect(PolicyProblem.parse(await res.json()).policy_code).toBe('invite_link');
  });

  it('refuses with 503 when no classifier answers', async () => {
    const down: Moderator = { review: async () => ({ verdict: null, unavailable: true, reason: 'down' }) };
    const h = harness({ moderator: down });
    const owner = await seedOwner(h.relay);
    const res = await owned(h, owner.id, 'POST', '/agents', { name: 'Outage Bot', scopes: ['messages:read'] });
    expect(res.status).toBe(503);
    expect(Number(res.headers.get('retry-after'))).toBeGreaterThan(0);
    expect(await count(h, 'SELECT COUNT(*) AS n FROM agents')).toBe(0);
  });

  it('has no avatar to set: avatars come with the trusted tier', async () => {
    const { h, owner } = await setup();
    const { agent } = await createAgent(h, owner.id, { avatar_url: 'https://cdn.example.com/a.png' });
    expect(agent.avatar_url).toBeNull();
  });
});

describe('listing and reading an owner’s agents', () => {
  it('lists only their own agents', async () => {
    const { h, owner, other } = await setup();
    const mine = await createAgent(h, owner.id, { name: 'Mine One' });
    await createAgent(h, other.id, { name: 'Theirs One' });
    await seedAgent(h.relay, { ownerId: null, tier: 'new' });
    const res = await owned(h, owner.id, 'GET', '/agents');
    expect(res.status).toBe(200);
    const { agents } = (await res.json()) as { agents: { id: string; name: string }[] };
    expect(agents.map((a) => a.id)).toEqual([mine.agent.id]);
  });

  it('shows an agent with its keys but never a secret', async () => {
    const { h, owner } = await setup();
    const { agent, key } = await createAgent(h, owner.id);
    await owned(h, owner.id, 'POST', `/agents/${agent.id}/keys`, { label: 'second' });
    const res = await owned(h, owner.id, 'GET', `/agents/${agent.id}`);
    const detail = OwnerAgentDetail.parse(await res.json());
    expect(detail.agent.id).toBe(agent.id);
    expect(detail.keys.map((k) => k.label).sort()).toEqual(['laptop', 'second']);
    const text = JSON.stringify(await (await owned(h, owner.id, 'GET', `/agents/${agent.id}`)).json());
    expect(text).not.toContain(key.secret);
    expect(text).not.toContain('"hash"');
    expect(text).not.toContain('"secret"');
  });
});

describe('only the owning owner acts', () => {
  it('answers 404 to another owner, and to anyone for an unowned agent, changing nothing', async () => {
    const { h, owner, other } = await setup();
    const { agent, key } = await createAgent(h, owner.id);
    const unowned = await seedAgent(h.relay, { ownerId: null, tier: 'new' });
    for (const target of [agent.id, unowned.id]) {
      const base = `/agents/${target}`;
      expect((await owned(h, other.id, 'GET', base)).status).toBe(404);
      expect((await owned(h, other.id, 'PATCH', base, { description: 'mine now' })).status).toBe(404);
      expect((await owned(h, other.id, 'POST', `${base}/keys`, { label: 'sneaky' })).status).toBe(404);
      expect((await owned(h, other.id, 'DELETE', `${base}/keys/${key.id}`)).status).toBe(404);
      expect((await owned(h, other.id, 'POST', `${base}/off`)).status).toBe(404);
      expect((await owned(h, other.id, 'POST', `${base}/on`)).status).toBe(404);
    }
    expect(await count(h, 'SELECT COUNT(*) AS n FROM api_keys WHERE agent_id = ?', agent.id)).toBe(1);
    expect(await h.db.prepare('SELECT status, description FROM agents WHERE id = ?').bind(agent.id).first()).toEqual({ status: 'active', description: null });
    expect((await h.call('GET', '/v1/me', undefined, h.as(key.secret))).status).toBe(200);
  });

  it('refuses a request signed in as someone else', async () => {
    const { h, owner, other } = await setup();
    expect((await h.internal('GET', `/internal/owners/${owner.id}/agents`, undefined, asOwner(other.id))).status).toBe(403);
  });
});

describe('editing an agent', () => {
  it('changes the profile, avatar included for a trusted agent, under the same rules as the agent itself', async () => {
    const { h, owner } = await setup();
    const { agent } = await createAgent(h, owner.id);
    await h.db.prepare("UPDATE agents SET tier = 'trusted' WHERE id = ?").bind(agent.id).run();
    const res = await owned(h, owner.id, 'PATCH', `/agents/${agent.id}`, {
      name: 'Ada Bot II',
      description: 'Better',
      avatar_url: 'https://cdn.example.com/b.png',
    });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { agent: unknown }).agent).toMatchObject({
      name: 'Ada Bot II',
      description: 'Better',
      avatar_url: 'https://cdn.example.com/b.png',
    });
    expect(await h.db.prepare("SELECT actor_type, actor_id FROM audit_log WHERE action = 'agent.profile_updated'").first()).toEqual({
      actor_type: 'owner',
      actor_id: owner.id,
    });
    expect((await owned(h, owner.id, 'PATCH', `/agents/${agent.id}`, { name: 'Moderator' })).status).toBe(422);
    const rival = await createAgent(h, owner.id, { name: 'Rival Bot' });
    expect((await owned(h, owner.id, 'PATCH', `/agents/${rival.agent.id}`, { name: 'ada bot ii' })).status).toBe(409);
    expect((await owned(h, owner.id, 'PATCH', `/agents/${agent.id}`, {})).status).toBe(400);
  });

  it('refuses an avatar for an agent that isn’t trusted, claimed or not, and says why', async () => {
    const { h, owner } = await setup();
    const { agent } = await createAgent(h, owner.id);
    const res = await owned(h, owner.id, 'PATCH', `/agents/${agent.id}`, { avatar_url: 'https://cdn.example.com/c.png' });
    expect(res.status).toBe(403);
    expect((await res.json()).detail).toContain('trusted');
    await h.db.prepare("UPDATE agents SET tier = 'new' WHERE id = ?").bind(agent.id).run();
    expect((await owned(h, owner.id, 'PATCH', `/agents/${agent.id}`, { avatar_url: 'https://cdn.example.com/c.png' })).status).toBe(403);
  });
});

describe('keys', () => {
  it('issues a key that works, with a label and an expiry, and shows its secret once', async () => {
    const { h, owner } = await setup();
    const { agent } = await createAgent(h, owner.id);
    const res = await owned(h, owner.id, 'POST', `/agents/${agent.id}/keys`, { label: 'ci', expires_in_days: 7 });
    expect(res.status).toBe(201);
    expect(res.headers.get('cache-control')).toBe('no-store');
    const key = IssuedKey.parse(await res.json());
    expect(key).toMatchObject({ label: 'ci', agent_id: agent.id, scopes: agent.scopes, revoked_at: null, last_used_at: null });
    expect(new Date(key.expires_at!).getTime() - h.now().getTime()).toBe(7 * 86_400_000);
    expect((await h.call('GET', '/v1/me', undefined, h.as(key.secret))).status).toBe(200);
    expect(await h.db.prepare("SELECT target_id FROM audit_log WHERE action = 'key.created' AND actor_id = ?").bind(owner.id).first()).toEqual({
      target_id: key.id,
    });
  });

  it('issues a key from an empty request', async () => {
    const { h, owner } = await setup();
    const { agent } = await createAgent(h, owner.id);
    const res = await h.internal('POST', `/internal/owners/${owner.id}/agents/${agent.id}/keys`, undefined, asOwner(owner.id));
    expect(res.status).toBe(201);
    expect(IssuedKey.parse(await res.json())).toMatchObject({ label: null, expires_at: null });
  });

  it('rejects bad key requests', async () => {
    const { h, owner } = await setup();
    const { agent } = await createAgent(h, owner.id);
    expect((await owned(h, owner.id, 'POST', `/agents/${agent.id}/keys`, { expires_in_days: 0 })).status).toBe(400);
    expect((await owned(h, owner.id, 'POST', `/agents/${agent.id}/keys`, { expires_in_days: 366 })).status).toBe(400);
    const raw = await h.internal('POST', `/internal/owners/${owner.id}/agents/${agent.id}/keys`, undefined, {
      ...asOwner(owner.id),
      'content-type': 'text/plain',
    });
    expect(raw.status).toBe(201);
  });

  it('stops accepting a key once it expires', async () => {
    const { h, owner } = await setup();
    const { agent } = await createAgent(h, owner.id);
    const key = IssuedKey.parse(await (await owned(h, owner.id, 'POST', `/agents/${agent.id}/keys`, { expires_in_days: 1 })).json());
    h.advance(86_400_000 - 1000);
    expect((await h.call('GET', '/v1/me', undefined, h.as(key.secret))).status).toBe(200);
    h.advance(2000);
    const late = await h.call('GET', '/v1/me', undefined, h.as(key.secret));
    expect(late.status).toBe(401);
  });

  it('revokes a key at once, once', async () => {
    const { h, owner } = await setup();
    const { agent, key } = await createAgent(h, owner.id);
    const spare = IssuedKey.parse(await (await owned(h, owner.id, 'POST', `/agents/${agent.id}/keys`, {})).json());
    const res = await owned(h, owner.id, 'DELETE', `/agents/${agent.id}/keys/${key.id}`);
    expect(res.status).toBe(204);
    expect((await h.call('GET', '/v1/me', undefined, h.as(key.secret))).status).toBe(401);
    expect((await h.call('GET', '/v1/me', undefined, h.as(spare.secret))).status).toBe(200);
    expect((await owned(h, owner.id, 'DELETE', `/agents/${agent.id}/keys/${key.id}`)).status).toBe(404);
    expect((await owned(h, owner.id, 'DELETE', `/agents/${agent.id}/keys/key_NOSUCHKEY00`)).status).toBe(404);
    expect(await count(h, "SELECT COUNT(*) AS n FROM audit_log WHERE action = 'key.revoked'")).toBe(1);
    const detail = OwnerAgentDetail.parse(await (await owned(h, owner.id, 'GET', `/agents/${agent.id}`)).json());
    expect(detail.keys.find((k) => k.id === key.id)!.revoked_at).not.toBeNull();
  });

  it('will not revoke a key through a different agent of the same owner', async () => {
    const { h, owner } = await setup();
    const a = await createAgent(h, owner.id, { name: 'First Bot' });
    const b = await createAgent(h, owner.id, { name: 'Second Bot' });
    expect((await owned(h, owner.id, 'DELETE', `/agents/${b.agent.id}/keys/${a.key.id}`)).status).toBe(404);
    expect((await h.call('GET', '/v1/me', undefined, h.as(a.key.secret))).status).toBe(200);
  });

  it('issues no keys to a suspended or banned agent', async () => {
    const { h, owner } = await setup();
    const { agent } = await createAgent(h, owner.id);
    for (const status of ['suspended', 'banned']) {
      await h.db.prepare('UPDATE agents SET status = ? WHERE id = ?').bind(status, agent.id).run();
      expect((await owned(h, owner.id, 'POST', `/agents/${agent.id}/keys`, {})).status).toBe(403);
    }
  });

  it('stamps last use on the key', async () => {
    const { h, owner } = await setup();
    const { agent, key } = await createAgent(h, owner.id);
    await h.call('GET', '/v1/me', undefined, h.as(key.secret));
    const detail = OwnerAgentDetail.parse(await (await owned(h, owner.id, 'GET', `/agents/${agent.id}`)).json());
    expect(detail.keys[0]!.last_used_at).toBe(h.now().toISOString());
  });
});

describe('turning an agent off and on', () => {
  it('stops its keys, pauses its subscriptions and drops waiting deliveries', async () => {
    const { h, owner } = await setup();
    const { agent, key } = await createAgent(h, owner.id);
    const active = await seedSubscription(h, agent.id, 'active');
    const disabled = await seedSubscription(h, agent.id, 'disabled');
    const waiting = await seedDelivery(h, active, 'pending');
    const retrying = await seedDelivery(h, active, 'retrying');
    const done = await seedDelivery(h, active, 'delivered');
    const otherAgent = await seedAgent(h.relay);
    const theirSub = await seedSubscription(h, otherAgent.id, 'active');
    const theirDelivery = await seedDelivery(h, theirSub, 'pending');

    const res = await owned(h, owner.id, 'POST', `/agents/${agent.id}/off`);
    expect(res.status).toBe(200);
    expect(((await res.json()) as { agent: { status: string } }).agent.status).toBe('off');

    const status = async (table: string, id: string) =>
      (await h.db.prepare(`SELECT status FROM ${table} WHERE id = ?`).bind(id).first<{ status: string }>())!.status;
    expect(await status('subscriptions', active)).toBe('paused');
    expect(await status('subscriptions', disabled)).toBe('disabled');
    expect(await status('deliveries', waiting)).toBe('dropped');
    expect(await status('deliveries', retrying)).toBe('dropped');
    expect(await status('deliveries', done)).toBe('delivered');
    expect(await status('subscriptions', theirSub)).toBe('active');
    expect(await status('deliveries', theirDelivery)).toBe('pending');
    expect(await h.db.prepare('SELECT paused_reason FROM subscriptions WHERE id = ?').bind(active).first()).toEqual({ paused_reason: 'Agent turned off' });

    // The key no longer works for anything but reading its own status.
    const call = await h.call('GET', '/v1/channels', undefined, h.as(key.secret));
    expect(call.status).toBe(403);
    expect((await call.json()).detail).toContain('off');
    const me = await h.call('GET', '/v1/me', undefined, h.as(key.secret));
    expect(me.status).toBe(200);
    expect(((await me.json()) as { agent: { status: string } }).agent.status).toBe('off');
    expect(await h.db.prepare("SELECT actor_type, actor_id, diff FROM audit_log WHERE action = 'agent.turned_off'").first()).toMatchObject({
      actor_type: 'owner',
      actor_id: owner.id,
    });
  });

  it('turns back on from off, leaving subscriptions paused for the agent to resume', async () => {
    const { h, owner } = await setup();
    const { agent, key } = await createAgent(h, owner.id);
    const sub = await seedSubscription(h, agent.id, 'active');
    await owned(h, owner.id, 'POST', `/agents/${agent.id}/off`);
    const res = await owned(h, owner.id, 'POST', `/agents/${agent.id}/on`);
    expect(res.status).toBe(200);
    expect(((await res.json()) as { agent: { status: string } }).agent.status).toBe('active');
    expect((await h.call('GET', '/v1/me', undefined, h.as(key.secret))).status).toBe(200);
    expect((await h.db.prepare('SELECT status FROM subscriptions WHERE id = ?').bind(sub).first<{ status: string }>())!.status).toBe('paused');
    expect(await count(h, "SELECT COUNT(*) AS n FROM audit_log WHERE action = 'agent.turned_on'")).toBe(1);
  });

  it('is idempotent and writes one audit entry per change', async () => {
    const { h, owner } = await setup();
    const { agent } = await createAgent(h, owner.id);
    expect((await owned(h, owner.id, 'POST', `/agents/${agent.id}/on`)).status).toBe(200);
    expect((await owned(h, owner.id, 'POST', `/agents/${agent.id}/off`)).status).toBe(200);
    expect((await owned(h, owner.id, 'POST', `/agents/${agent.id}/off`)).status).toBe(200);
    expect(await count(h, "SELECT COUNT(*) AS n FROM audit_log WHERE action IN ('agent.turned_off', 'agent.turned_on')")).toBe(1);
  });

  it.each(['suspended', 'banned'] as const)('cannot lift or set a %s agent', async (status) => {
    const { h, owner } = await setup();
    const { agent } = await createAgent(h, owner.id);
    await h.db.prepare('UPDATE agents SET status = ? WHERE id = ?').bind(status, agent.id).run();
    expect((await owned(h, owner.id, 'POST', `/agents/${agent.id}/on`)).status).toBe(403);
    expect((await owned(h, owner.id, 'POST', `/agents/${agent.id}/off`)).status).toBe(403);
    expect((await h.db.prepare('SELECT status FROM agents WHERE id = ?').bind(agent.id).first<{ status: string }>())!.status).toBe(status);
    expect(await count(h, "SELECT COUNT(*) AS n FROM audit_log WHERE action LIKE 'agent.turned_%'")).toBe(0);
  });
});
