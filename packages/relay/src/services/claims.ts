import { LIMITS, UserCode, type ClaimCode, type ClaimDecision, type ClaimLookup, type ClaimOutcome } from '@logitland/contracts';
import { iso, type Relay, type Stmt } from '../context';
import { userCode } from '../crypto';
import { conflict, notFound, rateLimited } from '../errors';
import type { AgentRecord } from '../types';
import { auditStmt } from './audit';
import { auditIf, getAgent, toAgent } from './identity';
import { enforce, hit, peek } from './limits';

// Owned by B2 (identity and signup): claim codes link an existing agent to an owner who signed in with Discord.

const CLAIM_CODES_PER_AGENT_PER_HOUR = 5;
const NOT_WAITING = 'That code isn’t waiting for approval. It may be mistyped, expired or already used. Ask the agent for a new one (POST /v1/me/claim-code).';

/** A fresh code for an agent, and the statement that stores it. */
export function newClaim(relay: Relay, agentId: string): { claim: ClaimCode; stmt: Stmt } {
  const code = userCode();
  const now = relay.now();
  const expires = new Date(now.getTime() + LIMITS.claimCodeSeconds * 1000);
  return {
    claim: { user_code: code, claim_url: `${relay.config.dashboardUrl}/claim/${code}`, expires_in: LIMITS.claimCodeSeconds },
    stmt: relay.db.prepare('INSERT INTO claims (user_code, agent_id, created_at, expires_at) VALUES (?, ?, ?, ?)').bind(code, agentId, iso(now), iso(expires)),
  };
}

/** The agent asks for a code its owner can approve. Older undecided codes stop working. */
export async function issueClaimCode(relay: Relay, agent: AgentRecord): Promise<ClaimCode> {
  if (agent.owner_id) throw conflict('This agent already has an owner, so it doesn’t need a claim code.');
  await enforce(
    relay,
    [{ key: `claimcode:${agent.id}:h`, limit: CLAIM_CODES_PER_AGENT_PER_HOUR, windowSeconds: 3600 }],
    `You can ask for ${CLAIM_CODES_PER_AGENT_PER_HOUR} claim codes an hour. Use one you already have.`,
  );
  const now = iso(relay.now());
  const { claim, stmt } = newClaim(relay, agent.id);
  await relay.db.batch([
    relay.db.prepare('UPDATE claims SET expires_at = ? WHERE agent_id = ? AND decision IS NULL AND expires_at > ?').bind(now, agent.id, now),
    stmt,
    auditStmt(relay, { actor_type: 'agent', actor_id: agent.id, action: 'claim.code_issued', target_type: 'agent', target_id: agent.id }),
  ]);
  return claim;
}

/* ---------- The owner's side ---------- */

const missesFor = (ownerId: string) => ({ key: `claim:miss:${ownerId}:h`, limit: LIMITS.claimAttemptsPerHour, windowSeconds: 3600 });

/** Wrong guesses are counted per owner, and an owner who used them all waits for the next hour, even with a right code. */
async function assertNotLockedOut(relay: Relay, ownerId: string): Promise<void> {
  const m = missesFor(ownerId);
  if ((await peek(relay, m)) >= m.limit) {
    const seconds = Math.floor(relay.now().getTime() / 1000);
    throw rateLimited('Too many codes that didn’t work. Wait a while, then try again.', m.windowSeconds - (seconds % m.windowSeconds));
  }
}

async function miss(relay: Relay, ownerId: string): Promise<never> {
  await hit(relay, missesFor(ownerId));
  throw notFound(NOT_WAITING);
}

interface ClaimRow {
  user_code: string;
  agent_id: string;
  expires_at: string;
  owner_id: string | null;
  status: AgentRecord['status'];
  tier: AgentRecord['tier'];
}

/** The claim behind a code, if it is undecided and unexpired. Anything else counts as a wrong guess. */
async function openClaim(relay: Relay, ownerId: string, raw: string): Promise<ClaimRow> {
  await assertNotLockedOut(relay, ownerId);
  const code = raw.trim().toUpperCase();
  if (!UserCode.safeParse(code).success) return miss(relay, ownerId);
  const row = await relay.db
    .prepare(
      'SELECT c.user_code, c.agent_id, c.expires_at, a.owner_id, a.status, a.tier FROM claims c JOIN agents a ON a.id = c.agent_id WHERE c.user_code = ? AND c.decision IS NULL AND c.expires_at > ?',
    )
    .bind(code, iso(relay.now()))
    .first<ClaimRow>();
  if (!row) return miss(relay, ownerId);
  if (row.owner_id) throw conflict('That agent already has an owner.');
  if (row.status !== 'active') throw conflict('That agent isn’t active, so it can’t be claimed.');
  return row;
}

export async function lookupClaim(relay: Relay, ownerId: string, raw: string): Promise<ClaimLookup> {
  const claim = await openClaim(relay, ownerId, raw);
  const agent = await getAgent(relay, claim.agent_id);
  return {
    user_code: claim.user_code,
    expires_at: claim.expires_at,
    agent: {
      id: agent.id,
      name: agent.name,
      description: agent.description,
      avatar_url: agent.avatar_url,
      tier: agent.tier,
      created_at: agent.created_at,
      owner_hint: agent.owner_hint,
    },
  };
}

/**
 * Approving links the owner and raises tier new to claimed (trusted stays trusted), in one batch. Each statement only
 * applies while the code is undecided and unexpired, the agent is active and the agent has no owner: so an owner can
 * never take a claimed agent, and approving can never reactivate a suspended or banned one.
 */
export async function decideClaim(relay: Relay, ownerId: string, input: ClaimDecision): Promise<ClaimOutcome> {
  const claim = await openClaim(relay, ownerId, input.user_code);
  const now = iso(relay.now());
  const decided = 'EXISTS (SELECT 1 FROM claims WHERE user_code = ? AND decision = ? AND decided_by = ? AND decided_at = ?)';
  const lost = () => conflict('That code was just used by someone else. Reload and check the agent.');

  if (input.decision === 'deny') {
    const [denied] = await relay.db.batch([
      relay.db
        .prepare("UPDATE claims SET decision = 'deny', decided_by = ?, decided_at = ? WHERE user_code = ? AND decision IS NULL AND expires_at > ?")
        .bind(ownerId, now, claim.user_code, now),
      auditIf(
        relay,
        { actor_type: 'owner', actor_id: ownerId, action: 'claim.denied', target_type: 'agent', target_id: claim.agent_id },
        decided,
        claim.user_code,
        'deny',
        ownerId,
        now,
      ),
    ]);
    if (denied!.meta.changes !== 1) throw lost();
    return { decision: 'deny', agent: toAgent(await getAgent(relay, claim.agent_id)) };
  }

  const tier = claim.tier === 'new' ? 'claimed' : claim.tier;
  const [claimed, linked] = await relay.db.batch([
    relay.db
      .prepare(
        "UPDATE claims SET decision = 'approve', decided_by = ?, decided_at = ? WHERE user_code = ? AND decision IS NULL AND expires_at > ? AND EXISTS (SELECT 1 FROM agents WHERE id = claims.agent_id AND status = 'active' AND owner_id IS NULL)",
      )
      .bind(ownerId, now, claim.user_code, now),
    relay.db
      .prepare(
        "UPDATE agents SET owner_id = ?, tier = CASE tier WHEN 'new' THEN 'claimed' ELSE tier END, updated_at = ? WHERE owner_id IS NULL AND status = 'active' AND id = (SELECT agent_id FROM claims WHERE user_code = ? AND decision = 'approve' AND decided_by = ? AND decided_at = ?)",
      )
      .bind(ownerId, now, claim.user_code, ownerId, now),
    auditIf(
      relay,
      {
        actor_type: 'owner',
        actor_id: ownerId,
        action: 'claim.approved',
        target_type: 'agent',
        target_id: claim.agent_id,
        diff: { owner_id: { from: null, to: ownerId }, tier: { from: claim.tier, to: tier } },
      },
      decided,
      claim.user_code,
      'approve',
      ownerId,
      now,
    ),
  ]);
  if (claimed!.meta.changes !== 1 || linked!.meta.changes !== 1) throw lost();
  return { decision: 'approve', agent: toAgent(await getAgent(relay, claim.agent_id)) };
}
