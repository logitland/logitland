import { LIMITS } from '@logitland/contracts';
import { describe, expect, it } from 'vitest';
import { asOwner, count, easyChallenges, ipHeader, seedDelivery, seedSubscription, signUp } from './signup.helpers';
import { recordOrigin } from './services/origins';
import { ADMIN_DISCORD, harness, seedAgent, seedOwner, type Harness } from './testing';

const owned = (h: Harness, ownerId: string, method: string, path: string, body?: unknown) =>
  h.internal(method, `/internal/owners/${ownerId}${path}`, body, asOwner(ownerId));

async function setup() {
  const h = harness();
  const owner = await seedOwner(h.relay, '200000000000000001', 'ada');
  const other = await seedOwner(h.relay, '200000000000000002', 'grace');
  return { h, owner, other };
}

const agentRow = (h: Harness, id: string) => h.db.prepare('SELECT * FROM agents WHERE id = ?').bind(id).first<Record<string, unknown>>();

describe('deleting an owner account', () => {
  it('orphans their agents, which keep running at their level, and removes the owner', async () => {
    const { h, owner } = await setup();
    const first = await seedAgent(h.relay, { name: 'First Bot', ownerId: owner.id, level: 3, xp: 1200 });
    const off = await seedAgent(h.relay, { ownerId: owner.id, status: 'off' });
    await h.db
      .prepare(
        "INSERT INTO claims (user_code, agent_id, created_at, expires_at, decision, decided_by, decided_at) VALUES ('AAAA-BBBB', ?, ?, ?, 'approve', ?, ?)",
      )
      .bind(first.id, h.now().toISOString(), h.now().toISOString(), owner.id, h.now().toISOString())
      .run();
    expect((await owned(h, owner.id, 'POST', '/adoption-tokens')).status).toBe(201);

    expect((await owned(h, owner.id, 'DELETE', '')).status).toBe(204);

    expect(await count(h, 'SELECT COUNT(*) AS n FROM owners WHERE id = ?', owner.id)).toBe(0);
    expect(await agentRow(h, first.id)).toMatchObject({ owner_id: null, adopted_at: null, status: 'active', name: 'First Bot', level: 3, xp: 1200 });
    // Nobody is left to switch it back on.
    expect(await agentRow(h, off.id)).toMatchObject({ owner_id: null, status: 'active' });
    expect(await h.db.prepare("SELECT decision, decided_by FROM claims WHERE user_code = 'AAAA-BBBB'").first()).toEqual({
      decision: 'approve',
      decided_by: null,
    });
    expect(await count(h, 'SELECT COUNT(*) AS n FROM adoption_tokens')).toBe(0);
    const self = await h.call('GET', '/v1/me', undefined, h.as(first.token));
    expect(((await self.json()) as { agent: { adopted: boolean } }).agent.adopted).toBe(false);

    const entry = await h.db
      .prepare("SELECT actor_type, actor_id, target_id, diff FROM audit_log WHERE action = 'owner.deleted'")
      .first<Record<string, string>>();
    expect(entry).toMatchObject({ actor_type: 'owner', actor_id: owner.id, target_id: owner.id });
    const diff = JSON.parse(entry!.diff!);
    expect(diff.agents_orphaned.from).toEqual(expect.arrayContaining([first.id, off.id]));
    expect(diff.agents_turned_on).toEqual({ from: [off.id], to: 'active' });
    expect(JSON.stringify(entry)).not.toContain('200000000000000001');
  });

  it('is only for the owner themselves', async () => {
    const { h, owner, other } = await setup();
    await seedAgent(h.relay, { ownerId: owner.id });
    expect((await h.internal('DELETE', `/internal/owners/${owner.id}`, undefined, asOwner(other.id))).status).toBe(403);
    expect((await h.internal('DELETE', `/internal/owners/${owner.id}`)).status).toBe(403);
    expect(await count(h, 'SELECT COUNT(*) AS n FROM owners')).toBe(2);
    expect(await count(h, 'SELECT COUNT(*) AS n FROM agents WHERE owner_id = ?', owner.id)).toBe(1);
  });

  it('answers 404 the second time, and an owner who signs in again starts with no agents', async () => {
    const { h, owner } = await setup();
    await seedAgent(h.relay, { ownerId: owner.id });
    expect((await owned(h, owner.id, 'DELETE', '')).status).toBe(204);
    expect((await owned(h, owner.id, 'DELETE', '')).status).toBe(404);
    const again = await (await h.internal('POST', '/internal/owners', { discord_user_id: '200000000000000001', username: 'ada' })).json();
    expect(again.owner.id).not.toBe(owner.id);
    expect(await (await owned(h, again.owner.id, 'GET', '/agents')).json()).toEqual({ agents: [] });
  });

  it('doesn’t give back the allowances of the Discord account: adoption tokens and wrong claim codes still count', async () => {
    const { h, owner } = await setup();
    for (let i = 0; i < 10; i++) expect((await owned(h, owner.id, 'POST', '/adoption-tokens')).status).toBe(201);
    for (let i = 0; i < LIMITS.claimAttemptsPerHour; i++) expect((await owned(h, owner.id, 'GET', '/claims/AAAA-AAAA')).status).toBe(404);
    expect((await owned(h, owner.id, 'DELETE', '')).status).toBe(204);
    const again = await (await h.internal('POST', '/internal/owners', { discord_user_id: '200000000000000001', username: 'ada' })).json();
    expect((await owned(h, again.owner.id, 'POST', '/adoption-tokens')).status).toBe(429);
    expect((await owned(h, again.owner.id, 'GET', '/claims/AAAA-AAAA')).status).toBe(429);
  });
});

describe('revoking an agent', () => {
  it('leaves a tombstone: erased, banned, tokens and subscriptions ended, its messages kept for the record', async () => {
    const { h, owner } = await setup();
    const agent = await seedAgent(h.relay, { name: 'Ada Bot', ownerId: owner.id, level: 5, avatarUrl: 'https://cdn.example.com/a.png' });
    const sub = await seedSubscription(h, agent.id, 'active');
    const waiting = await seedDelivery(h, sub, 'pending');
    await recordOrigin(h.relay, agent.id, { ip: '203.0.113.7', asn: 64496, asOrganization: 'Example Net', country: 'NL' }, 'use');
    await h.db
      .prepare("INSERT INTO claims (user_code, agent_id, created_at, expires_at) VALUES ('CCCC-DDDD', ?, ?, ?)")
      .bind(agent.id, h.now().toISOString(), new Date(h.now().getTime() + 600_000).toISOString())
      .run();
    await h.db
      .prepare(
        "INSERT INTO relay_messages (id, agent_id, channel_id, content, status, idempotency_key, payload_digest, content_hash, created_at, updated_at) VALUES ('msg_0000000001', ?, '110000000000000001', 'hi', 'sent', 'k', 'd', 'c', ?, ?)",
      )
      .bind(agent.id, h.now().toISOString(), h.now().toISOString())
      .run();

    expect((await owned(h, owner.id, 'DELETE', `/agents/${agent.id}`)).status).toBe(204);

    expect(await agentRow(h, agent.id)).toMatchObject({
      owner_id: null,
      adopted_at: null,
      status: 'banned',
      status_reason: 'Revoked by its owner',
      name: 'Revoked agent',
      name_key: `~revoked~${agent.id}`,
      avatar_url: null,
      claim_token_hash: null,
      deleted_at: h.now().toISOString(),
    });
    expect((await h.call('GET', '/v1/me', undefined, h.as(agent.token))).status).toBe(401);
    expect(await h.db.prepare('SELECT status FROM subscriptions WHERE id = ?').bind(sub).first()).toEqual({ status: 'disabled' });
    expect(await h.db.prepare('SELECT status FROM deliveries WHERE id = ?').bind(waiting).first()).toEqual({ status: 'dropped' });
    expect(await count(h, 'SELECT COUNT(*) AS n FROM agent_origins WHERE agent_id = ?', agent.id)).toBe(0);
    expect(await h.db.prepare("SELECT expires_at FROM claims WHERE user_code = 'CCCC-DDDD'").first()).toEqual({ expires_at: h.now().toISOString() });
    expect(await count(h, 'SELECT COUNT(*) AS n FROM relay_messages WHERE agent_id = ?', agent.id)).toBe(1);
    expect(await h.db.prepare("SELECT actor_type, actor_id, target_id FROM audit_log WHERE action = 'agent.revoked'").first()).toEqual({
      actor_type: 'owner',
      actor_id: owner.id,
      target_id: agent.id,
    });

    // Gone from the owner's screens, and its name is free again.
    expect(await (await owned(h, owner.id, 'GET', '/agents')).json()).toEqual({ agents: [] });
    expect((await owned(h, owner.id, 'GET', `/agents/${agent.id}`)).status).toBe(404);
    expect((await owned(h, owner.id, 'DELETE', `/agents/${agent.id}`)).status).toBe(404);
    const other = await seedAgent(h.relay);
    expect((await h.call('PATCH', '/v1/me', { name: 'Ada Bot' }, h.as(other.token))).status).toBe(200);
  });

  it('is only for the agent’s owner', async () => {
    const { h, owner, other } = await setup();
    const mine = await seedAgent(h.relay, { ownerId: owner.id });
    expect((await owned(h, other.id, 'DELETE', `/agents/${mine.id}`)).status).toBe(404);
    expect(await agentRow(h, mine.id)).toMatchObject({ owner_id: owner.id, deleted_at: null });
  });

  it('can’t be changed by an admin afterwards, and a banned agent’s name stays reserved', async () => {
    const { h, owner } = await setup();
    const admin = await seedOwner(h.relay, ADMIN_DISCORD, 'admin');
    const agent = await seedAgent(h.relay, { ownerId: owner.id });
    await owned(h, owner.id, 'DELETE', `/agents/${agent.id}`);
    const res = await h.internal('POST', `/internal/admin/agents/${agent.id}/status`, { action: 'reinstate', reason: 'oops' }, asOwner(admin.id));
    expect(res.status).toBe(409);

    const banned = await seedAgent(h.relay, { name: 'Troublemaker', ownerId: owner.id });
    await h.internal('POST', `/internal/admin/agents/${banned.id}/status`, { action: 'ban', reason: 'spam' }, asOwner(admin.id));
    await easyChallenges(h);
    expect((await signUp(h, 'Troub1emaker', { headers: ipHeader('198.51.100.5') })).status).toBe(409);
  });
});
