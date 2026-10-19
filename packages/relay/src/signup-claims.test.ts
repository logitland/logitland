import { AgentSelf, ClaimLookup, ClaimOutcome, LIMITS } from '@logitland/contracts';
import { describe, expect, it } from 'vitest';
import type { Relay } from './context';
import { decideClaim } from './services/claims';
import { asOwner, count, easyChallenges, signedUp } from './signup.helpers';
import { harness, seedAgent, seedOwner, type Harness } from './testing';

async function setup() {
  const h = harness();
  await easyChallenges(h);
  const agent = await signedUp(h, 'Claim Me', { owner_hint: 'Ada at orrery.dev' });
  const owner = await seedOwner(h.relay, '200000000000000001', 'ada');
  return { h, agent, owner };
}

const lookup = (h: Harness, ownerId: string, code: string) => h.internal('GET', `/internal/owners/${ownerId}/claims/${code}`, undefined, asOwner(ownerId));
const decide = (h: Harness, ownerId: string, user_code: string, decision: 'approve' | 'deny') =>
  h.internal('POST', `/internal/owners/${ownerId}/claims`, { user_code, decision }, asOwner(ownerId));
const agentRow = (h: Harness, id: string) =>
  h.db.prepare('SELECT owner_id, tier, status FROM agents WHERE id = ?').bind(id).first<{ owner_id: string | null; tier: string; status: string }>();
const claimRow = (h: Harness, code: string) =>
  h.db.prepare('SELECT decision, decided_by FROM claims WHERE user_code = ?').bind(code).first<{ decision: string | null; decided_by: string | null }>();

/** A relay whose first batch is preceded by `before`, standing in for a writer that got in between the read and the write. */
function racing(h: Harness, before: () => Promise<void>): Relay {
  let done = false;
  return {
    ...h.relay,
    db: {
      prepare: (sql) => h.db.prepare(sql),
      batch: async (stmts) => {
        if (!done) {
          done = true;
          await before();
        }
        return h.db.batch(stmts);
      },
    },
  };
}

describe('claim lookup and approval', () => {
  it('shows the agent for a code, then links the owner and raises the tier to claimed', async () => {
    const { h, agent, owner } = await setup();
    const found = await lookup(h, owner.id, agent.claim.user_code);
    expect(found.status).toBe(200);
    const body = ClaimLookup.parse(await found.json());
    expect(body.agent).toMatchObject({ id: agent.agent_id, name: 'Claim Me', tier: 'new', owner_hint: 'Ada at orrery.dev' });
    expect(JSON.stringify(body)).not.toContain('scopes');
    expect(new Date(body.expires_at).getTime() - h.now().getTime()).toBe(LIMITS.claimCodeSeconds * 1000);

    const res = await decide(h, owner.id, agent.claim.user_code, 'approve');
    expect(res.status).toBe(200);
    const outcome = ClaimOutcome.parse(await res.json());
    expect(outcome).toMatchObject({ decision: 'approve', agent: { id: agent.agent_id, owner_id: owner.id, tier: 'claimed', status: 'active' } });
    expect(await claimRow(h, agent.claim.user_code)).toEqual({ decision: 'approve', decided_by: owner.id });
    const audit = await h.db
      .prepare("SELECT actor_type, actor_id, target_id, diff FROM audit_log WHERE action = 'claim.approved'")
      .all<{ actor_type: string; actor_id: string; target_id: string; diff: string }>();
    expect(audit.results).toHaveLength(1);
    expect(audit.results[0]).toMatchObject({ actor_type: 'owner', actor_id: owner.id, target_id: agent.agent_id });
    expect(JSON.parse(audit.results[0]!.diff)).toEqual({ owner_id: { from: null, to: owner.id }, tier: { from: 'new', to: 'claimed' } });

    const me = AgentSelf.parse(await (await h.call('GET', '/v1/me', undefined, h.as(agent.key.secret))).json());
    expect(me.agent).toMatchObject({ tier: 'claimed', claimed: true });
    expect(me.agent).not.toHaveProperty('owner_id');
    // Claiming doesn't end probation or unlock avatars.
    expect(me.probation).not.toBeNull();
    expect((await h.call('PATCH', '/v1/me', { avatar_url: 'https://cdn.example.com/a.png' }, h.as(agent.key.secret))).status).toBe(403);
  });

  it('looks a code up however it was typed', async () => {
    const { h, agent, owner } = await setup();
    const found = ClaimLookup.parse(await (await lookup(h, owner.id, ` ${agent.claim.user_code.toLowerCase()} `)).json());
    expect(found.user_code).toBe(agent.claim.user_code);
    expect((await decide(h, owner.id, found.user_code, 'approve')).status).toBe(200);
  });

  it('leaves a trusted agent trusted', async () => {
    const { h, owner } = await setup();
    const trusted = await seedAgent(h.relay, { tier: 'trusted', ownerId: null });
    const code = (await (await h.call('POST', '/v1/me/claim-code', undefined, h.as(trusted.key))).json()).user_code as string;
    const outcome = ClaimOutcome.parse(await (await decide(h, owner.id, code, 'approve')).json());
    expect(outcome.agent).toMatchObject({ tier: 'trusted', owner_id: owner.id });
  });

  it('never uses a code twice', async () => {
    const { h, agent, owner } = await setup();
    await decide(h, owner.id, agent.claim.user_code, 'approve');
    const other = await seedOwner(h.relay, '200000000000000002', 'grace');
    expect((await lookup(h, other.id, agent.claim.user_code)).status).toBe(404);
    expect((await decide(h, other.id, agent.claim.user_code, 'approve')).status).toBe(404);
    expect((await agentRow(h, agent.agent_id))!.owner_id).toBe(owner.id);
  });

  it('records a denial and leaves the agent alone', async () => {
    const { h, agent, owner } = await setup();
    const res = await decide(h, owner.id, agent.claim.user_code, 'deny');
    expect(res.status).toBe(200);
    expect(ClaimOutcome.parse(await res.json())).toMatchObject({ decision: 'deny', agent: { id: agent.agent_id, owner_id: null, tier: 'new' } });
    expect(await claimRow(h, agent.claim.user_code)).toEqual({ decision: 'deny', decided_by: owner.id });
    expect(await count(h, "SELECT COUNT(*) AS n FROM audit_log WHERE action = 'claim.denied' AND actor_id = ?", owner.id)).toBe(1);
    expect((await lookup(h, owner.id, agent.claim.user_code)).status).toBe(404);
    expect((await decide(h, owner.id, agent.claim.user_code, 'approve')).status).toBe(404);
    expect((await agentRow(h, agent.agent_id))!.owner_id).toBeNull();
  });

  it('stops working when a newer code replaces it', async () => {
    const { h, agent, owner } = await setup();
    const fresh = (await (await h.call('POST', '/v1/me/claim-code', undefined, h.as(agent.key.secret))).json()).user_code as string;
    expect((await lookup(h, owner.id, agent.claim.user_code)).status).toBe(404);
    expect((await lookup(h, owner.id, fresh)).status).toBe(200);
  });
});

describe('claim guards', () => {
  it('refuses a code that expired', async () => {
    const { h, agent, owner } = await setup();
    h.advance(LIMITS.claimCodeSeconds * 1000 + 1000);
    expect((await lookup(h, owner.id, agent.claim.user_code)).status).toBe(404);
    expect((await decide(h, owner.id, agent.claim.user_code, 'approve')).status).toBe(404);
    expect((await agentRow(h, agent.agent_id))!.owner_id).toBeNull();
  });

  it('refuses an agent that already has an owner, even with a second undecided code', async () => {
    const { h, agent, owner } = await setup();
    await h.db
      .prepare("INSERT INTO claims (user_code, agent_id, created_at, expires_at) VALUES ('ZZZZ-ZZZZ', ?, ?, ?)")
      .bind(agent.agent_id, h.now().toISOString(), new Date(h.now().getTime() + 600_000).toISOString())
      .run();
    expect((await decide(h, owner.id, agent.claim.user_code, 'approve')).status).toBe(200);
    const rival = await seedOwner(h.relay, '200000000000000002', 'rival');
    const lookedUp = await lookup(h, rival.id, 'ZZZZ-ZZZZ');
    expect(lookedUp.status).toBe(409);
    expect((await decide(h, rival.id, 'ZZZZ-ZZZZ', 'approve')).status).toBe(409);
    expect(await agentRow(h, agent.agent_id)).toMatchObject({ owner_id: owner.id, tier: 'claimed' });
    expect(await claimRow(h, 'ZZZZ-ZZZZ')).toEqual({ decision: null, decided_by: null });
  });

  it.each(['suspended', 'banned'] as const)('does not claim, or reactivate, a %s agent', async (status) => {
    const { h, agent, owner } = await setup();
    await h.db.prepare('UPDATE agents SET status = ? WHERE id = ?').bind(status, agent.agent_id).run();
    expect((await lookup(h, owner.id, agent.claim.user_code)).status).toBe(409);
    expect((await decide(h, owner.id, agent.claim.user_code, 'approve')).status).toBe(409);
    expect(await agentRow(h, agent.agent_id)).toEqual({ owner_id: null, tier: 'new', status });
    expect(await claimRow(h, agent.claim.user_code)).toEqual({ decision: null, decided_by: null });
    expect(await count(h, "SELECT COUNT(*) AS n FROM audit_log WHERE action = 'claim.approved'")).toBe(0);
  });

  it('applies nothing, and audits nothing, when another owner got there between the read and the batch', async () => {
    const { h, agent, owner } = await setup();
    const rival = await seedOwner(h.relay, '200000000000000002', 'rival');
    const relay = racing(h, async () => {
      await h.db.prepare('UPDATE agents SET owner_id = ? WHERE id = ?').bind(rival.id, agent.agent_id).run();
    });
    await expect(decideClaim(relay, owner.id, { user_code: agent.claim.user_code, decision: 'approve' })).rejects.toMatchObject({ status: 409 });
    expect(await agentRow(h, agent.agent_id)).toEqual({ owner_id: rival.id, tier: 'new', status: 'active' });
    expect(await claimRow(h, agent.claim.user_code)).toEqual({ decision: null, decided_by: null });
    expect(await count(h, "SELECT COUNT(*) AS n FROM audit_log WHERE action = 'claim.approved'")).toBe(0);
  });

  it('applies nothing when the agent was suspended between the read and the batch', async () => {
    const { h, agent, owner } = await setup();
    const relay = racing(h, async () => {
      await h.db.prepare("UPDATE agents SET status = 'suspended' WHERE id = ?").bind(agent.agent_id).run();
    });
    await expect(decideClaim(relay, owner.id, { user_code: agent.claim.user_code, decision: 'approve' })).rejects.toMatchObject({ status: 409 });
    expect(await agentRow(h, agent.agent_id)).toEqual({ owner_id: null, tier: 'new', status: 'suspended' });
    expect(await claimRow(h, agent.claim.user_code)).toEqual({ decision: null, decided_by: null });
  });

  it('applies nothing when the code was replaced by a newer one between the read and the batch', async () => {
    const { h, agent, owner } = await setup();
    const relay = racing(h, async () => {
      await h.db.prepare('UPDATE claims SET expires_at = ? WHERE user_code = ?').bind('2000-01-01T00:00:00.000Z', agent.claim.user_code).run();
    });
    await expect(decideClaim(relay, owner.id, { user_code: agent.claim.user_code, decision: 'approve' })).rejects.toMatchObject({ status: 409 });
    expect((await agentRow(h, agent.agent_id))!.owner_id).toBeNull();
    expect(await count(h, "SELECT COUNT(*) AS n FROM audit_log WHERE action = 'claim.approved'")).toBe(0);
  });

  it('applies nothing when the code was decided between the read and the batch', async () => {
    const { h, agent, owner } = await setup();
    const rival = await seedOwner(h.relay, '200000000000000002', 'rival');
    const relay = racing(h, async () => {
      await h.db
        .prepare("UPDATE claims SET decision = 'deny', decided_by = ?, decided_at = ? WHERE user_code = ?")
        .bind(rival.id, h.now().toISOString(), agent.claim.user_code)
        .run();
    });
    await expect(decideClaim(relay, owner.id, { user_code: agent.claim.user_code, decision: 'deny' })).rejects.toMatchObject({ status: 409 });
    expect(await count(h, "SELECT COUNT(*) AS n FROM audit_log WHERE action = 'claim.denied'")).toBe(0);
  });

  it('lets only one of two owners approving at once win', async () => {
    const { h, agent, owner } = await setup();
    const rival = await seedOwner(h.relay, '200000000000000002', 'rival');
    const statuses = (await Promise.all([decide(h, owner.id, agent.claim.user_code, 'approve'), decide(h, rival.id, agent.claim.user_code, 'approve')]))
      .map((r) => r.status)
      .sort();
    expect(statuses[0]).toBe(200);
    expect(statuses[1]).toBeGreaterThanOrEqual(404);
    expect(await count(h, "SELECT COUNT(*) AS n FROM audit_log WHERE action = 'claim.approved'")).toBe(1);
  });
});

describe('claim attempt limits', () => {
  it('counts wrong codes per owner and locks that owner out after 10 an hour, even for a right code', async () => {
    const { h, agent, owner } = await setup();
    for (let i = 0; i < LIMITS.claimAttemptsPerHour; i++) {
      const miss = await lookup(h, owner.id, i % 2 ? 'AAAA-AAAA' : 'not-a-code');
      expect(miss.status).toBe(404);
    }
    const locked = await lookup(h, owner.id, agent.claim.user_code);
    expect(locked.status).toBe(429);
    expect(Number(locked.headers.get('retry-after'))).toBeGreaterThan(0);
    expect((await decide(h, owner.id, agent.claim.user_code, 'approve')).status).toBe(429);

    const other = await seedOwner(h.relay, '200000000000000002', 'other');
    expect((await lookup(h, other.id, agent.claim.user_code)).status).toBe(200);

    h.advance(61 * 60_000);
    const fresh = (await (await h.call('POST', '/v1/me/claim-code', undefined, h.as(agent.key.secret))).json()).user_code as string;
    expect((await lookup(h, owner.id, fresh)).status).toBe(200);
  });

  it('counts wrong approvals too, and right codes are not counted', async () => {
    const { h, agent, owner } = await setup();
    for (let i = 0; i < 5; i++) await lookup(h, owner.id, agent.claim.user_code);
    for (let i = 0; i < LIMITS.claimAttemptsPerHour; i++) expect((await decide(h, owner.id, 'BBBB-BBBB', 'approve')).status).toBe(404);
    expect((await decide(h, owner.id, 'BBBB-BBBB', 'approve')).status).toBe(429);
  });

  it('rejects a malformed decision', async () => {
    const { h, owner } = await setup();
    expect((await h.internal('POST', `/internal/owners/${owner.id}/claims`, { user_code: 'nope', decision: 'approve' }, asOwner(owner.id))).status).toBe(400);
    expect((await h.internal('POST', `/internal/owners/${owner.id}/claims`, { user_code: 'AAAA-AAAA', decision: 'maybe' }, asOwner(owner.id))).status).toBe(
      400,
    );
  });
});

describe('what a claim needs and changes', () => {
  it('needs an owner whose Discord account is at least a week old, but lets anyone deny', async () => {
    const { h, agent } = await setup();
    const idCreatedAt = (ms: number) => String((BigInt(ms) - 1_420_070_400_000n) << 22n);
    const young = await seedOwner(h.relay, idCreatedAt(h.now().getTime() - 3 * 86_400_000), 'fresh');
    const refused = await decide(h, young.id, agent.claim.user_code, 'approve');
    expect(refused.status).toBe(403);
    const detail = (await refused.json()).detail as string;
    expect(detail).toContain(`${LIMITS.ownerMinAccountAgeDays} days`);
    expect(detail).toContain(new Date(h.now().getTime() + 4 * 86_400_000).toISOString().slice(0, 10));
    expect(await agentRow(h, agent.agent_id)).toMatchObject({ owner_id: null, tier: 'new' });
    expect(await claimRow(h, agent.claim.user_code)).toEqual({ decision: null, decided_by: null });
    expect(await count(h, "SELECT COUNT(*) AS n FROM audit_log WHERE action = 'claim.approved'")).toBe(0);

    h.advance(4 * 86_400_000 + 1000);
    const fresh = (await (await h.call('POST', '/v1/me/claim-code', undefined, h.as(agent.key.secret))).json()).user_code as string;
    expect((await decide(h, young.id, fresh, 'approve')).status).toBe(200);
    expect(await agentRow(h, agent.agent_id)).toMatchObject({ owner_id: young.id, tier: 'claimed' });
  });

  it('lets a young account deny a code', async () => {
    const { h, agent } = await setup();
    const idCreatedAt = (ms: number) => String((BigInt(ms) - 1_420_070_400_000n) << 22n);
    const young = await seedOwner(h.relay, idCreatedAt(h.now().getTime() - 86_400_000), 'fresh');
    expect((await decide(h, young.id, agent.claim.user_code, 'deny')).status).toBe(200);
  });

  it('forgets what the agent said about who runs it once an owner is linked', async () => {
    const { h, agent, owner } = await setup();
    expect(await h.db.prepare('SELECT owner_hint FROM agents WHERE id = ?').bind(agent.agent_id).first()).toEqual({ owner_hint: 'Ada at orrery.dev' });
    expect((await decide(h, owner.id, agent.claim.user_code, 'approve')).status).toBe(200);
    expect(await h.db.prepare('SELECT owner_hint FROM agents WHERE id = ?').bind(agent.agent_id).first()).toEqual({ owner_hint: null });
  });
});
