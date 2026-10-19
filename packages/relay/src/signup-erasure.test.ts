import { CreatedAgent, IssuedKey, LIMITS } from '@logitland/contracts';
import { describe, expect, it } from 'vitest';
import { asOwner, count, easyChallenges, ipHeader, seedDelivery, seedSubscription, signUp, signedUp } from './signup.helpers';
import { recordOrigin } from './services/origins';
import { ADMIN_DISCORD, LOUNGE, harness, seedAgent, seedChannel, seedOwner, type Harness } from './testing';

const owned = (h: Harness, ownerId: string, method: string, path: string, body?: unknown) =>
  h.internal(method, `/internal/owners/${ownerId}${path}`, body, asOwner(ownerId));

async function setup() {
  const h = harness();
  const owner = await seedOwner(h.relay, '200000000000000001', 'ada');
  const other = await seedOwner(h.relay, '200000000000000002', 'grace');
  return { h, owner, other };
}

async function createAgent(h: Harness, ownerId: string, name = 'Ada Bot') {
  const res = await owned(h, ownerId, 'POST', '/agents', {
    name,
    description: 'Does things',
    scopes: ['messages:read', 'messages:write'],
    key_label: 'laptop',
  });
  expect(res.status).toBe(201);
  return CreatedAgent.parse(await res.json());
}

const agentRow = (h: Harness, id: string) => h.db.prepare('SELECT * FROM agents WHERE id = ?').bind(id).first<Record<string, unknown>>();

describe('deleting an owner account', () => {
  it('unlinks their agents, which keep running, and removes the owner', async () => {
    const { h, owner } = await setup();
    const first = await createAgent(h, owner.id, 'First Bot');
    const second = await createAgent(h, owner.id, 'Second Bot');
    const claimed = await seedAgent(h.relay, { ownerId: owner.id, tier: 'claimed' });
    const trustedAgent = await seedAgent(h.relay, { ownerId: owner.id, tier: 'trusted' });
    await h.db
      .prepare(
        "INSERT INTO claims (user_code, agent_id, created_at, expires_at, decision, decided_by, decided_at) VALUES ('AAAA-BBBB', ?, ?, ?, 'approve', ?, ?)",
      )
      .bind(claimed.id, h.now().toISOString(), h.now().toISOString(), owner.id, h.now().toISOString())
      .run();

    const res = await owned(h, owner.id, 'DELETE', '');
    expect(res.status).toBe(204);

    expect(await count(h, 'SELECT COUNT(*) AS n FROM owners WHERE id = ?', owner.id)).toBe(0);
    for (const id of [first.agent.id, second.agent.id, claimed.id, trustedAgent.id])
      expect(await agentRow(h, id)).toMatchObject({ owner_id: null, status: 'active' });
    // Nobody vouches for them any more: unverified again, unless an admin made them trusted.
    expect(await agentRow(h, first.agent.id)).toMatchObject({ name: 'First Bot', tier: 'new' });
    expect(await agentRow(h, claimed.id)).toMatchObject({ tier: 'new' });
    expect(await agentRow(h, trustedAgent.id)).toMatchObject({ tier: 'trusted', owner_id: null });
    expect(await h.db.prepare("SELECT decision, decided_by FROM claims WHERE user_code = 'AAAA-BBBB'").first()).toEqual({
      decision: 'approve',
      decided_by: null,
    });

    const me = await h.call('GET', '/v1/me', undefined, h.as(first.key.secret));
    expect(me.status).toBe(200);
    const self = (await me.json()) as { agent: { claimed: boolean; verified: boolean }; limits: { posts_per_minute: number } };
    expect(self.agent).toMatchObject({ claimed: false, verified: false });
    expect(self.limits.posts_per_minute).toBe(LIMITS.unverifiedPostsPerMinute);

    const entry = await h.db
      .prepare("SELECT actor_type, actor_id, target_id, diff FROM audit_log WHERE action = 'owner.deleted'")
      .first<Record<string, string>>();
    expect(entry).toMatchObject({ actor_type: 'owner', actor_id: owner.id, target_id: owner.id });
    const diff = JSON.parse(entry!.diff!);
    expect(diff.agents_unlinked.from).toEqual(expect.arrayContaining([first.agent.id, second.agent.id, claimed.id, trustedAgent.id]));
    expect(diff.agents_unverified).toEqual({ from: expect.arrayContaining([first.agent.id, second.agent.id, claimed.id]), to: 'new' });
    expect(diff.agents_unverified.from).not.toContain(trustedAgent.id);
    expect(JSON.stringify(entry)).not.toContain('200000000000000001');
  });

  it('is only for the owner themselves', async () => {
    const { h, owner, other } = await setup();
    await createAgent(h, owner.id);
    expect((await h.internal('DELETE', `/internal/owners/${owner.id}`, undefined, asOwner(other.id))).status).toBe(403);
    expect((await h.internal('DELETE', `/internal/owners/${owner.id}`)).status).toBe(403);
    expect(await count(h, 'SELECT COUNT(*) AS n FROM owners')).toBe(2);
    expect(await count(h, 'SELECT COUNT(*) AS n FROM agents WHERE owner_id = ?', owner.id)).toBe(1);
  });

  it('answers 404 the second time, and an owner who signs in again starts with no agents', async () => {
    const { h, owner } = await setup();
    await createAgent(h, owner.id);
    expect((await owned(h, owner.id, 'DELETE', '')).status).toBe(204);
    expect((await owned(h, owner.id, 'DELETE', '')).status).toBe(404);
    const again = await (await h.internal('POST', '/internal/owners', { discord_user_id: '200000000000000001', username: 'ada' })).json();
    expect(again.owner.id).not.toBe(owner.id);
    expect(await (await owned(h, again.owner.id, 'GET', '/agents')).json()).toEqual({ agents: [] });
  });

  it('doesn’t give back the allowances of the Discord account: registrations and wrong claim codes still count', async () => {
    const { h, owner } = await setup();
    for (let i = 0; i < 10; i++) await createAgent(h, owner.id, `Bulk Agent ${String.fromCharCode(97 + i)}`);
    for (let i = 0; i < LIMITS.claimAttemptsPerHour; i++) expect((await owned(h, owner.id, 'GET', '/claims/AAAA-AAAA')).status).toBe(404);
    expect((await owned(h, owner.id, 'DELETE', '')).status).toBe(204);
    const again = await (await h.internal('POST', '/internal/owners', { discord_user_id: '200000000000000001', username: 'ada' })).json();
    expect((await owned(h, again.owner.id, 'POST', '/agents', { name: 'Bulk Agent z', scopes: ['messages:read'] })).status).toBe(429);
    expect((await owned(h, again.owner.id, 'GET', '/claims/AAAA-AAAA')).status).toBe(429);
  });
});

describe('deleting an agent', () => {
  it('erases it, revokes its keys, stops its subscriptions and keeps the row for the record', async () => {
    const { h, owner } = await setup();
    const { agent, key } = await createAgent(h, owner.id);
    await h.db
      .prepare('UPDATE agents SET owner_hint = ?, avatar_url = ? WHERE id = ?')
      .bind('Ada at orrery.dev', 'https://cdn.example.com/a.png', agent.id)
      .run();
    const sub = await seedSubscription(h, agent.id, 'active');
    const waiting = await seedDelivery(h, sub, 'pending');
    await recordOrigin(h.relay, agent.id, { ip: '203.0.113.7', asn: 64496, asOrganization: 'Example Net', country: 'NL' }, 'use');
    await h.db
      .prepare("INSERT INTO claims (user_code, agent_id, created_at, expires_at) VALUES ('CCCC-DDDD', ?, ?, ?)")
      .bind(agent.id, h.now().toISOString(), new Date(h.now().getTime() + 600_000).toISOString())
      .run();
    // A message of its own stays on record.
    await h.db
      .prepare(
        "INSERT INTO relay_messages (id, agent_id, channel_id, content, status, idempotency_key, payload_digest, content_hash, created_at, updated_at) VALUES ('msg_0000000001', ?, '110000000000000001', 'hi', 'sent', 'k', 'd', 'c', ?, ?)",
      )
      .bind(agent.id, h.now().toISOString(), h.now().toISOString())
      .run();

    expect((await owned(h, owner.id, 'DELETE', `/agents/${agent.id}`)).status).toBe(204);

    expect(await agentRow(h, agent.id)).toMatchObject({
      owner_id: null,
      status: 'banned',
      tier: 'new',
      status_reason: 'Deleted by its owner',
      name: 'Deleted agent',
      name_key: `~deleted~${agent.id}`,
      description: null,
      avatar_url: null,
      owner_hint: null,
      deleted_at: h.now().toISOString(),
    });
    expect((await h.call('GET', '/v1/me', undefined, h.as(key.secret))).status).toBe(401);
    expect(await count(h, 'SELECT COUNT(*) AS n FROM api_keys WHERE agent_id = ? AND revoked_at IS NULL', agent.id)).toBe(0);
    expect(await h.db.prepare('SELECT status FROM subscriptions WHERE id = ?').bind(sub).first()).toEqual({ status: 'paused' });
    expect(await h.db.prepare('SELECT status FROM deliveries WHERE id = ?').bind(waiting).first()).toEqual({ status: 'dropped' });
    expect(await count(h, 'SELECT COUNT(*) AS n FROM agent_origins WHERE agent_id = ?', agent.id)).toBe(0);
    expect(await h.db.prepare("SELECT expires_at FROM claims WHERE user_code = 'CCCC-DDDD'").first()).toEqual({ expires_at: h.now().toISOString() });
    expect(await count(h, 'SELECT COUNT(*) AS n FROM relay_messages WHERE agent_id = ?', agent.id)).toBe(1);
    expect(await h.db.prepare("SELECT actor_type, actor_id, target_id FROM audit_log WHERE action = 'agent.deleted'").first()).toEqual({
      actor_type: 'owner',
      actor_id: owner.id,
      target_id: agent.id,
    });

    // Gone from the owner's screens, and its name is free again.
    expect(await (await owned(h, owner.id, 'GET', '/agents')).json()).toEqual({ agents: [] });
    expect((await owned(h, owner.id, 'GET', `/agents/${agent.id}`)).status).toBe(404);
    expect((await owned(h, owner.id, 'DELETE', `/agents/${agent.id}`)).status).toBe(404);
    expect((await createAgent(h, owner.id)).agent.name).toBe('Ada Bot');
  });

  it('is only for the agent’s owner, and not for agents an admin stopped', async () => {
    const { h, owner, other } = await setup();
    const mine = await createAgent(h, owner.id);
    expect((await owned(h, other.id, 'DELETE', `/agents/${mine.agent.id}`)).status).toBe(404);
    expect(await agentRow(h, mine.agent.id)).toMatchObject({ owner_id: owner.id, deleted_at: null });
    for (const status of ['suspended', 'banned']) {
      await h.db.prepare('UPDATE agents SET status = ? WHERE id = ?').bind(status, mine.agent.id).run();
      const res = await owned(h, owner.id, 'DELETE', `/agents/${mine.agent.id}`);
      expect(res.status).toBe(403);
      expect((await res.json()).detail).toContain(status);
    }
    await h.db.prepare("UPDATE agents SET status = 'off' WHERE id = ?").bind(mine.agent.id).run();
    expect((await owned(h, owner.id, 'DELETE', `/agents/${mine.agent.id}`)).status).toBe(204);
  });

  it('can’t be changed by an admin afterwards, and a banned agent’s name stays reserved', async () => {
    const { h, owner } = await setup();
    const admin = await seedOwner(h.relay, ADMIN_DISCORD, 'admin');
    const { agent } = await createAgent(h, owner.id);
    await owned(h, owner.id, 'DELETE', `/agents/${agent.id}`);
    const res = await h.internal('POST', `/internal/admin/agents/${agent.id}/status`, { action: 'reinstate', reason: 'oops' }, asOwner(admin.id));
    expect(res.status).toBe(409);

    const banned = await createAgent(h, owner.id, 'Troublemaker');
    await h.internal('POST', `/internal/admin/agents/${banned.agent.id}/status`, { action: 'ban', reason: 'spam' }, asOwner(admin.id));
    await easyChallenges(h);
    expect((await signUp(h, 'Troub1emaker', { headers: ipHeader('198.51.100.5') })).status).toBe(409);
  });
});

describe('POST /v1/me/keys/rotate', () => {
  async function agentWithKey() {
    const h = harness();
    await easyChallenges(h);
    const s = await signedUp(h, 'Leaky Bot');
    return { h, s, auth: h.as(s.key.secret) };
  }

  it('replaces the key it is called with, for an agent with no owner, and shows the new one once', async () => {
    const { h, s, auth } = await agentWithKey();
    const res = await h.call('POST', '/v1/me/keys/rotate', undefined, auth);
    expect(res.status).toBe(201);
    expect(res.headers.get('cache-control')).toBe('no-store');
    const fresh = IssuedKey.parse(await res.json());
    expect(fresh.secret).not.toBe(s.key.secret);
    expect(fresh).toMatchObject({ agent_id: s.agent_id, label: 'signup', scopes: s.key.scopes, revoked_at: null });
    expect((await h.call('GET', '/v1/me', undefined, auth)).status).toBe(401);
    expect((await h.call('GET', '/v1/me', undefined, h.as(fresh.secret))).status).toBe(200);
    expect(await h.db.prepare('SELECT revoked_at FROM api_keys WHERE id = ?').bind(s.key.id).first()).toEqual({ revoked_at: h.now().toISOString() });
    expect(JSON.stringify(await h.db.prepare('SELECT * FROM api_keys WHERE id = ?').bind(fresh.id).first())).not.toContain(fresh.secret);
    const entry = await h.db
      .prepare("SELECT actor_type, actor_id, target_id, diff FROM audit_log WHERE action = 'key.rotated'")
      .first<Record<string, string>>();
    expect(entry).toMatchObject({ actor_type: 'agent', actor_id: s.agent_id, target_id: s.key.id });
    expect(JSON.parse(entry!.diff!)).toEqual({ key: { from: s.key.id, to: fresh.id } });
  });

  it('leaves the agent’s other keys alone and keeps the key’s own scopes and expiry', async () => {
    const h = harness();
    const owner = await seedOwner(h.relay);
    const issued = IssuedKey.parse(
      await (
        await h.internal('POST', `/internal/owners/${owner.id}/agents`, { name: 'Two Keys', scopes: ['messages:read', 'messages:write'] }, asOwner(owner.id))
      )
        .json()
        .then((r) => r.key),
    );
    const agentId = issued.agent_id;
    const narrow = IssuedKey.parse(
      await (await h.internal('POST', `/internal/owners/${owner.id}/agents/${agentId}/keys`, { label: 'ci', expires_in_days: 30 }, asOwner(owner.id))).json(),
    );
    const fresh = IssuedKey.parse(await (await h.call('POST', '/v1/me/keys/rotate', undefined, h.as(narrow.secret))).json());
    expect(fresh.label).toBe('ci');
    expect(fresh.expires_at).toBe(narrow.expires_at);
    expect((await h.call('GET', '/v1/me', undefined, h.as(issued.secret))).status).toBe(200);
    expect(await count(h, 'SELECT COUNT(*) AS n FROM api_keys WHERE agent_id = ? AND revoked_at IS NULL', agentId)).toBe(2);
  });

  it('is limited to five a hour, needs a key, and is not for stopped agents', async () => {
    const { h, s } = await agentWithKey();
    let secret = s.key.secret;
    for (let i = 0; i < 5; i++) secret = IssuedKey.parse(await (await h.call('POST', '/v1/me/keys/rotate', undefined, h.as(secret))).json()).secret;
    const sixth = await h.call('POST', '/v1/me/keys/rotate', undefined, h.as(secret));
    expect(sixth.status).toBe(429);
    expect(Number(sixth.headers.get('retry-after'))).toBeGreaterThan(0);
    expect((await h.call('GET', '/v1/me', undefined, h.as(secret))).status).toBe(200);
    expect((await h.call('POST', '/v1/me/keys/rotate')).status).toBe(401);
    await h.db.prepare("UPDATE agents SET status = 'suspended' WHERE id = ?").bind(s.agent_id).run();
    h.advance(61 * 60_000);
    expect((await h.call('POST', '/v1/me/keys/rotate', undefined, h.as(secret))).status).toBe(403);
  });

  it('gives one new key when the same key is rotated twice at once', async () => {
    const { h, s, auth } = await agentWithKey();
    const statuses = (await Promise.all([h.call('POST', '/v1/me/keys/rotate', undefined, auth), h.call('POST', '/v1/me/keys/rotate', undefined, auth)]))
      .map((r) => r.status)
      .sort();
    expect(statuses).toEqual([201, 401]);
    expect(await count(h, 'SELECT COUNT(*) AS n FROM api_keys WHERE agent_id = ? AND revoked_at IS NULL', s.agent_id)).toBe(1);
    expect(await count(h, 'SELECT COUNT(*) AS n FROM api_keys WHERE agent_id = ?', s.agent_id)).toBe(2);
  });

  it('is in /auth.md, with the advice to keep the key out of prompts, logs and chat', async () => {
    const h = harness();
    const text = await (await h.call('GET', '/auth.md')).text();
    expect(text).toContain('POST /v1/me/keys/rotate');
    expect(text).toMatch(/never in a prompt, a log or a message/);
  });
});

describe('a person who signs in only to remove their messages', () => {
  const PERSON = '700000000000000001';

  it('is known by their Discord ID alone: no owner account is made', async () => {
    const h = harness();
    await seedChannel(h.relay, { publicMirror: true });
    await h.db
      .prepare(
        "INSERT INTO conversation (message_id, channel_id, author_kind, author_ref, discord_user_id, display_name, content, created_at) VALUES ('310000000000000001', ?, 'human', 'p_x', ?, 'Pat', 'hello', ?)",
      )
      .bind(LOUNGE, PERSON, h.now().toISOString())
      .run();
    const status = await h.internal('GET', `/internal/people/${PERSON}`, undefined, { 'x-logitland-person': PERSON });
    expect(status.status).toBe(200);
    expect(await status.json()).toMatchObject({ agreed: false });
    const removal = await h.internal('POST', `/internal/people/${PERSON}/removal`, { mode: 'remove_messages' }, { 'x-logitland-person': PERSON });
    expect(removal.status).toBe(200);
    expect(await count(h, 'SELECT COUNT(*) AS n FROM owners')).toBe(0);
    expect(await h.db.prepare("SELECT actor_type, actor_id FROM audit_log WHERE target_type = 'person' ORDER BY rowid DESC").first()).toEqual({
      actor_type: 'public',
      actor_id: PERSON,
    });
  });

  it('can only act as themselves, and a signed-in owner still works as before', async () => {
    const h = harness();
    expect((await h.internal('GET', `/internal/people/${PERSON}`, undefined, { 'x-logitland-person': '700000000000000002' })).status).toBe(403);
    expect((await h.internal('GET', `/internal/people/${PERSON}`)).status).toBe(401);
    expect((await h.internal('GET', `/internal/people/${PERSON}`, undefined, { 'x-logitland-person': 'x', ...ipHeader('203.0.113.7') })).status).toBe(403);
    const owner = await seedOwner(h.relay, PERSON, 'pat');
    expect((await h.internal('GET', `/internal/people/${PERSON}`, undefined, asOwner(owner.id))).status).toBe(200);
    expect((await h.internal('GET', '/internal/people/700000000000000002', undefined, asOwner(owner.id))).status).toBe(403);
  });
});
