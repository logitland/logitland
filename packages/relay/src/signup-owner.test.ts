import { AdoptionToken, LIMITS, OwnerSession, PolicyProblem } from '@logitland/contracts';
import { describe, expect, it } from 'vitest';
import { updateSettings } from './services/settings';
import { asOwner, count, seedDelivery, seedSubscription } from './signup.helpers';
import { ADMIN_DISCORD, harness, seedAgent, seedOwner, type Harness } from './testing';

const owned = (h: Harness, ownerId: string, method: string, path: string, body?: unknown) =>
  h.internal(method, `/internal/owners/${ownerId}${path}`, body, asOwner(ownerId));

async function setup() {
  const h = harness();
  const owner = await seedOwner(h.relay, '200000000000000001', 'ada');
  const other = await seedOwner(h.relay, '200000000000000002', 'grace');
  return { h, owner, other };
}

const idCreatedAt = (ms: number) => String((BigInt(ms) - 1_420_070_400_000n) << 22n);

async function makeToken(h: Harness, ownerId: string) {
  const res = await owned(h, ownerId, 'POST', '/adoption-tokens');
  expect(res.status).toBe(201);
  return AdoptionToken.parse(await res.json());
}

const adopt = (h: Harness, agentToken: string, token: string) => h.call('POST', '/v1/me/adopt', { token }, h.as(agentToken));

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

  it('marks the bot’s Developer team as admins', async () => {
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

describe('adoption tokens, owner to agent', () => {
  it('needs a Discord account at least a week old, counted from its snowflake', async () => {
    const h = harness();
    const young = await seedOwner(h.relay, idCreatedAt(h.now().getTime() - 6 * 86_400_000), 'fresh');
    const res = await owned(h, young.id, 'POST', '/adoption-tokens');
    expect(res.status).toBe(403);
    const detail = (await res.json()).detail as string;
    expect(detail).toContain(`${LIMITS.ownerMinAccountAgeDays} days`);
    expect(detail).toContain(new Date(h.now().getTime() + 86_400_000).toISOString().slice(0, 10));
    h.advance(86_400_000 + 1000);
    await makeToken(h, young.id);
  });

  it('limits an owner to 10 tokens an hour', async () => {
    const { h, owner } = await setup();
    for (let i = 0; i < 10; i++) await makeToken(h, owner.id);
    expect((await owned(h, owner.id, 'POST', '/adoption-tokens')).status).toBe(429);
  });

  it('limits an owner to 10 agents', async () => {
    const { h, owner } = await setup();
    for (let i = 0; i < 10; i++) await seedAgent(h.relay, { ownerId: owner.id });
    expect((await owned(h, owner.id, 'POST', '/adoption-tokens')).status).toBe(403);
  });

  it('can’t be used once cancelled or expired, and shows which', async () => {
    const { h, owner } = await setup();
    const agent = await seedAgent(h.relay);
    const cancelled = await makeToken(h, owner.id);
    expect((await owned(h, owner.id, 'DELETE', `/adoption-tokens/${cancelled.token}`)).status).toBe(204);
    expect((await adopt(h, agent.token, cancelled.token)).status).toBe(404);
    expect(AdoptionToken.parse(await (await owned(h, owner.id, 'GET', `/adoption-tokens/${cancelled.token}`)).json()).state).toBe('cancelled');

    const late = await makeToken(h, owner.id);
    h.advance(LIMITS.claimCodeSeconds * 1000 + 1000);
    expect((await adopt(h, agent.token, late.token)).status).toBe(404);
    expect(AdoptionToken.parse(await (await owned(h, owner.id, 'GET', `/adoption-tokens/${late.token}`)).json()).state).toBe('expired');
    expect(await count(h, 'SELECT COUNT(*) AS n FROM agents WHERE owner_id IS NOT NULL')).toBe(0);
  });

  it('is visible only to the owner who made it', async () => {
    const { h, owner, other } = await setup();
    const made = await makeToken(h, owner.id);
    expect((await owned(h, other.id, 'GET', `/adoption-tokens/${made.token}`)).status).toBe(404);
    expect((await owned(h, other.id, 'DELETE', `/adoption-tokens/${made.token}`)).status).toBe(404);
  });

  it('is refused by an agent that already has an owner, and while signups are closed', async () => {
    const { h, owner, other } = await setup();
    const adopted = await seedAgent(h.relay, { ownerId: other.id });
    const made = await makeToken(h, owner.id);
    expect((await adopt(h, adopted.token, made.token)).status).toBe(409);

    const orphan = await seedAgent(h.relay);
    await updateSettings(h.relay, 'own_test_setup', { signup_open: false });
    expect((await adopt(h, orphan.token, made.token)).status).toBe(403);
    expect(AdoptionToken.parse(await (await owned(h, owner.id, 'GET', `/adoption-tokens/${made.token}`)).json()).state).toBe('waiting');
  });

  it('locks an agent out after 10 wrong tokens an hour', async () => {
    const { h, owner } = await setup();
    const agent = await seedAgent(h.relay);
    for (let i = 0; i < LIMITS.claimAttemptsPerHour; i++) expect((await adopt(h, agent.token, 'AAAA-AAAA')).status).toBe(404);
    const made = await makeToken(h, owner.id);
    expect((await adopt(h, agent.token, made.token)).status).toBe(429);
  });
});

describe('listing and reading an owner’s agents', () => {
  it('lists only their own agents', async () => {
    const { h, owner, other } = await setup();
    const mine = await seedAgent(h.relay, { ownerId: owner.id });
    await seedAgent(h.relay, { ownerId: other.id });
    await seedAgent(h.relay);
    const res = await owned(h, owner.id, 'GET', '/agents');
    expect(res.status).toBe(200);
    const { agents } = (await res.json()) as { agents: { id: string }[] };
    expect(agents.map((a) => a.id)).toEqual([mine.id]);
    const one = await owned(h, owner.id, 'GET', `/agents/${mine.id}`);
    expect(((await one.json()) as { agent: { id: string; owner_id: string } }).agent).toMatchObject({ id: mine.id, owner_id: owner.id });
  });
});

describe('only the owning owner acts', () => {
  it('answers 404 to another owner, and to anyone for an unowned agent, changing nothing', async () => {
    const { h, owner, other } = await setup();
    const agent = await seedAgent(h.relay, { name: 'Ada Bot', ownerId: owner.id });
    const unowned = await seedAgent(h.relay);
    for (const target of [agent.id, unowned.id]) {
      const base = `/agents/${target}`;
      expect((await owned(h, other.id, 'GET', base)).status).toBe(404);
      expect((await owned(h, other.id, 'PATCH', base, { name: 'Mine Now' })).status).toBe(404);
      expect((await owned(h, other.id, 'DELETE', base)).status).toBe(404);
      expect((await owned(h, other.id, 'POST', `${base}/off`)).status).toBe(404);
      expect((await owned(h, other.id, 'POST', `${base}/on`)).status).toBe(404);
    }
    expect(await h.db.prepare('SELECT status, name FROM agents WHERE id = ?').bind(agent.id).first()).toEqual({ status: 'active', name: 'Ada Bot' });
    expect((await h.call('GET', '/v1/me', undefined, h.as(agent.token))).status).toBe(200);
  });

  it('refuses a request signed in as someone else', async () => {
    const { h, owner, other } = await setup();
    expect((await h.internal('GET', `/internal/owners/${owner.id}/agents`, undefined, asOwner(other.id))).status).toBe(403);
  });
});

describe('editing an agent', () => {
  it('changes the profile, avatar included at a level that allows it, under the same rules as the agent itself', async () => {
    const { h, owner } = await setup();
    const agent = await seedAgent(h.relay, { name: 'Ada Bot', ownerId: owner.id, level: 5 });
    const res = await owned(h, owner.id, 'PATCH', `/agents/${agent.id}`, { name: 'Ada Bot II', avatar_url: 'https://cdn.example.com/b.png' });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { agent: unknown }).agent).toMatchObject({
      name: 'Ada Bot II',
      avatar_url: 'https://cdn.example.com/b.png',
      custom_avatar: true,
    });
    expect(await h.db.prepare("SELECT actor_type, actor_id FROM audit_log WHERE action = 'agent.profile_updated'").first()).toEqual({
      actor_type: 'owner',
      actor_id: owner.id,
    });
    const rival = await seedAgent(h.relay, { name: 'Rival Bot', ownerId: owner.id });
    const reserved = await owned(h, owner.id, 'PATCH', `/agents/${rival.id}`, { name: 'Moderator' });
    expect(PolicyProblem.parse(await reserved.json()).policy_code).toBe('impersonation');
    expect((await owned(h, owner.id, 'PATCH', `/agents/${rival.id}`, { name: 'ada bot ii' })).status).toBe(409);
    expect((await owned(h, owner.id, 'PATCH', `/agents/${agent.id}`, {})).status).toBe(400);
  });

  it('refuses an avatar below the level that allows one, and says why', async () => {
    const { h, owner } = await setup();
    const agent = await seedAgent(h.relay, { ownerId: owner.id, level: 1 });
    const res = await owned(h, owner.id, 'PATCH', `/agents/${agent.id}`, { avatar_url: 'https://cdn.example.com/c.png' });
    expect(res.status).toBe(403);
    expect((await res.json()).detail).toContain('level');
  });

  it.each(['suspended', 'banned'] as const)('is refused for a %s agent', async (status) => {
    const { h, owner } = await setup();
    const agent = await seedAgent(h.relay, { name: 'Ada Bot', ownerId: owner.id, status });
    expect((await owned(h, owner.id, 'PATCH', `/agents/${agent.id}`, { name: 'Ada Bot II' })).status).toBe(403);
  });
});

describe('turning an agent off and on', () => {
  it('stops its tokens and drops waiting deliveries, keeping its subscriptions', async () => {
    const { h, owner } = await setup();
    const agent = await seedAgent(h.relay, { ownerId: owner.id });
    const sub = await seedSubscription(h, agent.id);
    const waiting = await seedDelivery(h, agent.id, 'pending');
    const retrying = await seedDelivery(h, agent.id, 'retrying');
    const done = await seedDelivery(h, agent.id, 'delivered');
    const otherAgent = await seedAgent(h.relay);
    const theirDelivery = await seedDelivery(h, otherAgent.id, 'pending');

    const res = await owned(h, owner.id, 'POST', `/agents/${agent.id}/off`);
    expect(res.status).toBe(200);
    expect(((await res.json()) as { agent: { status: string } }).agent.status).toBe('off');

    const status = async (table: string, id: string) =>
      (await h.db.prepare(`SELECT status FROM ${table} WHERE id = ?`).bind(id).first<{ status: string }>())!.status;
    expect(await count(h, 'SELECT COUNT(*) AS n FROM subscriptions WHERE id = ?', sub)).toBe(1);
    expect(await status('deliveries', waiting)).toBe('dropped');
    expect(await status('deliveries', retrying)).toBe('dropped');
    expect(await status('deliveries', done)).toBe('delivered');
    expect(await status('deliveries', theirDelivery)).toBe('pending');
    expect((await h.call('GET', '/v1/me', undefined, h.as(agent.token))).status).toBe(401);
    expect(await h.db.prepare("SELECT actor_type, actor_id FROM audit_log WHERE action = 'agent.turned_off'").first()).toEqual({
      actor_type: 'owner',
      actor_id: owner.id,
    });
  });

  it('turns back on from off; the agent exchanges its assertion for a new token', async () => {
    const { h, owner } = await setup();
    const agent = await seedAgent(h.relay, { ownerId: owner.id });
    await owned(h, owner.id, 'POST', `/agents/${agent.id}/off`);
    const res = await owned(h, owner.id, 'POST', `/agents/${agent.id}/on`);
    expect(res.status).toBe(200);
    expect(((await res.json()) as { agent: { status: string } }).agent.status).toBe('active');
    expect((await h.call('GET', '/v1/me', undefined, h.as(agent.token))).status).toBe(401);
    expect(await count(h, "SELECT COUNT(*) AS n FROM audit_log WHERE action = 'agent.turned_on'")).toBe(1);
  });

  it('is idempotent and writes one audit entry per change', async () => {
    const { h, owner } = await setup();
    const agent = await seedAgent(h.relay, { ownerId: owner.id });
    expect((await owned(h, owner.id, 'POST', `/agents/${agent.id}/on`)).status).toBe(200);
    expect((await owned(h, owner.id, 'POST', `/agents/${agent.id}/off`)).status).toBe(200);
    expect((await owned(h, owner.id, 'POST', `/agents/${agent.id}/off`)).status).toBe(200);
    expect(await count(h, "SELECT COUNT(*) AS n FROM audit_log WHERE action IN ('agent.turned_off', 'agent.turned_on')")).toBe(1);
  });

  it.each(['suspended', 'banned'] as const)('cannot lift or set a %s agent', async (status) => {
    const { h, owner } = await setup();
    const agent = await seedAgent(h.relay, { ownerId: owner.id, status });
    expect((await owned(h, owner.id, 'POST', `/agents/${agent.id}/on`)).status).toBe(403);
    expect((await owned(h, owner.id, 'POST', `/agents/${agent.id}/off`)).status).toBe(403);
    expect((await h.db.prepare('SELECT status FROM agents WHERE id = ?').bind(agent.id).first<{ status: string }>())!.status).toBe(status);
    expect(await count(h, "SELECT COUNT(*) AS n FROM audit_log WHERE action LIKE 'agent.turned_%'")).toBe(0);
  });
});
