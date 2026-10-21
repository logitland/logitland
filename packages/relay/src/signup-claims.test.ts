import { ClaimAttempt, ClaimLookup, ClaimOutcome, LIMITS } from '@logitland/contracts';
import { describe, expect, it } from 'vitest';
import type { Relay } from './context';
import { decideClaim } from './services/claims';
import { updateSettings } from './services/settings';
import { asOwner, count } from './signup.helpers';
import { harness, seedAgent, seedOwner, type Harness } from './testing';

// Adoption, agent to owner: the agent starts a claim (POST /agent/identity/claim) and the owner enters its code on the dashboard.

const start = (h: Harness, token: string) => h.call('POST', '/agent/identity/claim', undefined, h.as(token));
const code = async (h: Harness, token: string) => ClaimAttempt.parse(await (await start(h, token)).json()).claim_attempt.user_code;

async function setup() {
  const h = harness();
  const agent = await seedAgent(h.relay, { name: 'Claim Me', level: 2, xp: 450 });
  const owner = await seedOwner(h.relay, '200000000000000001', 'ada');
  return { h, agent, owner, userCode: await code(h, agent.token) };
}

const lookup = (h: Harness, ownerId: string, code: string) => h.internal('GET', `/internal/owners/${ownerId}/claims/${code}`, undefined, asOwner(ownerId));
const decide = (h: Harness, ownerId: string, user_code: string, decision: 'approve' | 'deny') =>
  h.internal('POST', `/internal/owners/${ownerId}/claims`, { user_code, decision }, asOwner(ownerId));
const agentRow = (h: Harness, id: string) =>
  h.db.prepare('SELECT owner_id, status FROM agents WHERE id = ?').bind(id).first<{ owner_id: string | null; status: string }>();
const claimRow = (h: Harness, code: string) =>
  h.db.prepare('SELECT decision, decided_by FROM claims WHERE user_code = ?').bind(code).first<{ decision: string | null; decided_by: string | null }>();
const adoptions = (h: Harness) => count(h, "SELECT COUNT(*) AS n FROM audit_log WHERE action = 'agent.adopted'");

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

describe('starting a claim', () => {
  it('issues a fresh code and expires the older undecided ones', async () => {
    const { h, agent, userCode } = await setup();
    const res = await start(h, agent.token);
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    const attempt = ClaimAttempt.parse(await res.json());
    expect(attempt.claim_attempt.user_code).not.toBe(userCode);
    expect(attempt.claim_attempt).toMatchObject({ expires_in: LIMITS.claimCodeSeconds, verification_uri: 'https://logitland.test/agents/adopt' });

    const old = await h.db.prepare('SELECT expires_at FROM claims WHERE user_code = ?').bind(userCode).first<{ expires_at: string }>();
    expect(old!.expires_at <= h.now().toISOString()).toBe(true);
    expect(await claimRow(h, attempt.claim_attempt.user_code)).toEqual({ decision: null, decided_by: null });
    expect(await count(h, "SELECT COUNT(*) AS n FROM audit_log WHERE action = 'claim.started'")).toBe(2);
  });

  it('keeps decided codes as they were', async () => {
    const { h, agent, userCode } = await setup();
    await h.db.prepare("UPDATE claims SET decision = 'deny', decided_at = ? WHERE user_code = ?").bind(h.now().toISOString(), userCode).run();
    const before = await h.db.prepare('SELECT expires_at FROM claims WHERE user_code = ?').bind(userCode).first();
    await start(h, agent.token);
    expect(await h.db.prepare('SELECT expires_at FROM claims WHERE user_code = ?').bind(userCode).first()).toEqual(before);
  });

  it('allows 5 claims an hour per agent', async () => {
    const h = harness();
    const a = await seedAgent(h.relay);
    for (let i = 0; i < 5; i++) expect((await start(h, a.token)).status).toBe(200);
    const sixth = await start(h, a.token);
    expect(sixth.status).toBe(429);
    expect(Number(sixth.headers.get('retry-after'))).toBeGreaterThan(0);
    const other = await seedAgent(h.relay);
    expect((await start(h, other.token)).status).toBe(200);
    h.advance(61 * 60_000);
    expect((await start(h, a.token)).status).toBe(200);
  });

  it('is refused for an agent that already has an owner', async () => {
    const h = harness();
    const owner = await seedOwner(h.relay);
    const adopted = await seedAgent(h.relay, { ownerId: owner.id });
    const res = await start(h, adopted.token);
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: 'claimed_or_in_flight' });
  });
});

describe('claim lookup and approval', () => {
  it('shows the agent for a code, then links the owner, keeping the agent’s level', async () => {
    const { h, agent, owner, userCode } = await setup();
    const found = await lookup(h, owner.id, userCode);
    expect(found.status).toBe(200);
    const body = ClaimLookup.parse(await found.json());
    expect(body.agent).toMatchObject({ id: agent.id, name: 'Claim Me', level: 2 });
    expect(JSON.stringify(body)).not.toContain('scopes');
    expect(new Date(body.expires_at).getTime() - h.now().getTime()).toBe(LIMITS.claimCodeSeconds * 1000);

    const res = await decide(h, owner.id, userCode, 'approve');
    expect(res.status).toBe(200);
    const outcome = ClaimOutcome.parse(await res.json());
    expect(outcome).toMatchObject({
      decision: 'approve',
      agent: { id: agent.id, owner_id: owner.id, adopted_at: h.now().toISOString(), level: 2, xp: 450, status: 'active' },
    });
    expect(await claimRow(h, userCode)).toEqual({ decision: 'approve', decided_by: owner.id });
    const audit = await h.db
      .prepare("SELECT actor_type, actor_id, target_id, diff FROM audit_log WHERE action = 'agent.adopted'")
      .all<{ actor_type: string; actor_id: string; target_id: string; diff: string }>();
    expect(audit.results).toHaveLength(1);
    expect(audit.results[0]).toMatchObject({ actor_type: 'owner', actor_id: owner.id, target_id: agent.id });
    expect(JSON.parse(audit.results[0]!.diff)).toEqual({ owner_id: { from: null, to: owner.id } });
  });

  it('looks a code up however it was typed', async () => {
    const { h, owner, userCode } = await setup();
    const found = ClaimLookup.parse(await (await lookup(h, owner.id, ` ${userCode.toLowerCase()} `)).json());
    expect(found.user_code).toBe(userCode);
    expect((await decide(h, owner.id, found.user_code, 'approve')).status).toBe(200);
  });

  it('never uses a code twice', async () => {
    const { h, agent, owner, userCode } = await setup();
    await decide(h, owner.id, userCode, 'approve');
    const other = await seedOwner(h.relay, '200000000000000002', 'grace');
    expect((await lookup(h, other.id, userCode)).status).toBe(404);
    expect((await decide(h, other.id, userCode, 'approve')).status).toBe(404);
    expect((await agentRow(h, agent.id))!.owner_id).toBe(owner.id);
  });

  it('records a denial and leaves the agent alone', async () => {
    const { h, agent, owner, userCode } = await setup();
    const res = await decide(h, owner.id, userCode, 'deny');
    expect(res.status).toBe(200);
    expect(ClaimOutcome.parse(await res.json())).toMatchObject({ decision: 'deny', agent: { id: agent.id, owner_id: null } });
    expect(await claimRow(h, userCode)).toEqual({ decision: 'deny', decided_by: owner.id });
    expect(await count(h, "SELECT COUNT(*) AS n FROM audit_log WHERE action = 'claim.denied' AND actor_id = ?", owner.id)).toBe(1);
    expect((await lookup(h, owner.id, userCode)).status).toBe(404);
    expect((await decide(h, owner.id, userCode, 'approve')).status).toBe(404);
    expect((await agentRow(h, agent.id))!.owner_id).toBeNull();
  });

  it('stops working when a newer code replaces it', async () => {
    const { h, agent, owner, userCode } = await setup();
    const fresh = await code(h, agent.token);
    expect((await lookup(h, owner.id, userCode)).status).toBe(404);
    expect((await lookup(h, owner.id, fresh)).status).toBe(200);
  });
});

describe('claim guards', () => {
  it('refuses a code that expired', async () => {
    const { h, agent, owner, userCode } = await setup();
    h.advance(LIMITS.claimCodeSeconds * 1000 + 1000);
    expect((await lookup(h, owner.id, userCode)).status).toBe(404);
    expect((await decide(h, owner.id, userCode, 'approve')).status).toBe(404);
    expect((await agentRow(h, agent.id))!.owner_id).toBeNull();
  });

  it('refuses an agent that already has an owner, even with a second undecided code', async () => {
    const { h, agent, owner, userCode } = await setup();
    await h.db
      .prepare("INSERT INTO claims (user_code, agent_id, created_at, expires_at) VALUES ('ZZZZ-ZZZZ', ?, ?, ?)")
      .bind(agent.id, h.now().toISOString(), new Date(h.now().getTime() + 600_000).toISOString())
      .run();
    expect((await decide(h, owner.id, userCode, 'approve')).status).toBe(200);
    const rival = await seedOwner(h.relay, '200000000000000002', 'rival');
    expect((await lookup(h, rival.id, 'ZZZZ-ZZZZ')).status).toBe(409);
    expect((await decide(h, rival.id, 'ZZZZ-ZZZZ', 'approve')).status).toBe(409);
    expect((await agentRow(h, agent.id))!.owner_id).toBe(owner.id);
    expect(await claimRow(h, 'ZZZZ-ZZZZ')).toEqual({ decision: null, decided_by: null });
  });

  it.each(['suspended', 'banned'] as const)('does not adopt, or reactivate, a %s agent', async (status) => {
    const { h, agent, owner, userCode } = await setup();
    await h.db.prepare('UPDATE agents SET status = ? WHERE id = ?').bind(status, agent.id).run();
    expect((await lookup(h, owner.id, userCode)).status).toBe(409);
    expect((await decide(h, owner.id, userCode, 'approve')).status).toBe(409);
    expect(await agentRow(h, agent.id)).toEqual({ owner_id: null, status });
    expect(await claimRow(h, userCode)).toEqual({ decision: null, decided_by: null });
    expect(await adoptions(h)).toBe(0);
  });

  it('applies nothing, and audits nothing, when another owner got there between the read and the batch', async () => {
    const { h, agent, owner, userCode } = await setup();
    const rival = await seedOwner(h.relay, '200000000000000002', 'rival');
    const relay = racing(h, async () => {
      await h.db.prepare('UPDATE agents SET owner_id = ? WHERE id = ?').bind(rival.id, agent.id).run();
    });
    await expect(decideClaim(relay, owner.id, { user_code: userCode, decision: 'approve' })).rejects.toMatchObject({ status: 409 });
    expect(await agentRow(h, agent.id)).toEqual({ owner_id: rival.id, status: 'active' });
    expect(await claimRow(h, userCode)).toEqual({ decision: null, decided_by: null });
    expect(await adoptions(h)).toBe(0);
  });

  it('applies nothing when the agent was suspended between the read and the batch', async () => {
    const { h, agent, owner, userCode } = await setup();
    const relay = racing(h, async () => {
      await h.db.prepare("UPDATE agents SET status = 'suspended' WHERE id = ?").bind(agent.id).run();
    });
    await expect(decideClaim(relay, owner.id, { user_code: userCode, decision: 'approve' })).rejects.toMatchObject({ status: 409 });
    expect(await agentRow(h, agent.id)).toEqual({ owner_id: null, status: 'suspended' });
    expect(await claimRow(h, userCode)).toEqual({ decision: null, decided_by: null });
  });

  it('applies nothing when the code was replaced by a newer one between the read and the batch', async () => {
    const { h, agent, owner, userCode } = await setup();
    const relay = racing(h, async () => {
      await h.db.prepare('UPDATE claims SET expires_at = ? WHERE user_code = ?').bind('2000-01-01T00:00:00.000Z', userCode).run();
    });
    await expect(decideClaim(relay, owner.id, { user_code: userCode, decision: 'approve' })).rejects.toMatchObject({ status: 409 });
    expect((await agentRow(h, agent.id))!.owner_id).toBeNull();
    expect(await adoptions(h)).toBe(0);
  });

  it('applies nothing when the code was decided between the read and the batch', async () => {
    const { h, owner, userCode } = await setup();
    const rival = await seedOwner(h.relay, '200000000000000002', 'rival');
    const relay = racing(h, async () => {
      await h.db
        .prepare("UPDATE claims SET decision = 'deny', decided_by = ?, decided_at = ? WHERE user_code = ?")
        .bind(rival.id, h.now().toISOString(), userCode)
        .run();
    });
    await expect(decideClaim(relay, owner.id, { user_code: userCode, decision: 'deny' })).rejects.toMatchObject({ status: 409 });
    expect(await count(h, "SELECT COUNT(*) AS n FROM audit_log WHERE action = 'claim.denied'")).toBe(0);
  });

  it('lets only one of two owners approving at once win', async () => {
    const { h, owner, userCode } = await setup();
    const rival = await seedOwner(h.relay, '200000000000000002', 'rival');
    const statuses = (await Promise.all([decide(h, owner.id, userCode, 'approve'), decide(h, rival.id, userCode, 'approve')])).map((r) => r.status).sort();
    expect(statuses[0]).toBe(200);
    expect(statuses[1]).toBeGreaterThanOrEqual(404);
    expect(await adoptions(h)).toBe(1);
  });
});

describe('claim attempt limits', () => {
  it('counts wrong codes per owner and locks that owner out after 10 an hour, even for a right code', async () => {
    const { h, agent, owner, userCode } = await setup();
    for (let i = 0; i < LIMITS.claimAttemptsPerHour; i++) {
      const miss = await lookup(h, owner.id, i % 2 ? 'AAAA-AAAA' : 'not-a-code');
      expect(miss.status).toBe(404);
    }
    const locked = await lookup(h, owner.id, userCode);
    expect(locked.status).toBe(429);
    expect(Number(locked.headers.get('retry-after'))).toBeGreaterThan(0);
    expect((await decide(h, owner.id, userCode, 'approve')).status).toBe(429);

    const other = await seedOwner(h.relay, '200000000000000002', 'other');
    expect((await lookup(h, other.id, userCode)).status).toBe(200);

    h.advance(61 * 60_000);
    expect((await lookup(h, owner.id, await code(h, agent.token))).status).toBe(200);
  });

  it('counts wrong approvals too, and right codes are not counted', async () => {
    const { h, owner, userCode } = await setup();
    for (let i = 0; i < 5; i++) await lookup(h, owner.id, userCode);
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

describe('what adopting needs', () => {
  it('needs an owner whose Discord account is at least a week old, but lets anyone deny', async () => {
    const { h, agent, userCode } = await setup();
    const idCreatedAt = (ms: number) => String((BigInt(ms) - 1_420_070_400_000n) << 22n);
    const young = await seedOwner(h.relay, idCreatedAt(h.now().getTime() - 3 * 86_400_000), 'fresh');
    const refused = await decide(h, young.id, userCode, 'approve');
    expect(refused.status).toBe(403);
    const detail = (await refused.json()).detail as string;
    expect(detail).toContain(`${LIMITS.ownerMinAccountAgeDays} days`);
    expect(detail).toContain(new Date(h.now().getTime() + 4 * 86_400_000).toISOString().slice(0, 10));
    expect((await agentRow(h, agent.id))!.owner_id).toBeNull();
    expect(await claimRow(h, userCode)).toEqual({ decision: null, decided_by: null });
    expect(await adoptions(h)).toBe(0);

    const other = await start(h, agent.token);
    const denyCode = ClaimAttempt.parse(await other.json()).claim_attempt.user_code;
    expect((await decide(h, young.id, denyCode, 'deny')).status).toBe(200);

    h.advance(4 * 86_400_000 + 1000);
    expect((await decide(h, young.id, await code(h, agent.token), 'approve')).status).toBe(200);
    expect((await agentRow(h, agent.id))!.owner_id).toBe(young.id);
  });

  it('is paused while signups are closed', async () => {
    const { h, owner, userCode } = await setup();
    await updateSettings(h.relay, 'own_test_setup', { signup_open: false });
    expect((await decide(h, owner.id, userCode, 'approve')).status).toBe(403);
    expect((await decide(h, owner.id, userCode, 'deny')).status).toBe(200);
  });
});
