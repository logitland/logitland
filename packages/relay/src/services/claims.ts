import { LIMITS, UserCode, type ClaimDecision, type ClaimLookup, type ClaimOutcome } from '@logitland/contracts';
import { iso, type Relay, type Stmt } from '../context';
import { userCode } from '../crypto';
import { conflict, forbidden, notFound, rateLimited } from '../errors';
import { assertOwnerEstablished, assertOwnerHasRoom, auditIf, getAgent, getOwner, ownerLimitKey, toAgent, toPublicAgent } from './identity';
import { hit, peek } from './limits';
import { getSettings } from './settings';

// Adoption, agent to owner (#17, auth.md's claim): the agent starts a claim and shows its owner a code (tokens.ts startClaim);
// the owner, signed in with Discord, enters it on the dashboard. Adopting gives the owner the agent's off switch, its messages
// and its budget, and gives the agent the adopted limits and permissions of its level.

const NOT_WAITING = 'That code isn’t waiting for approval. It may be mistyped, expired or already used. Ask the agent for a new one.';

/** A fresh code for an agent, and the statement that stores it. */
export function newClaim(relay: Relay, agentId: string): { claim: { user_code: string; expires_at: string }; stmt: Stmt } {
  const code = userCode();
  const now = relay.now();
  const expires = iso(new Date(now.getTime() + LIMITS.claimCodeSeconds * 1000));
  return {
    claim: { user_code: code, expires_at: expires },
    stmt: relay.db.prepare('INSERT INTO claims (user_code, agent_id, created_at, expires_at) VALUES (?, ?, ?, ?)').bind(code, agentId, iso(now), expires),
  };
}

/** Counted per Discord account, so deleting the owner account and signing in again doesn't bring the guesses back. */
const missesFor = async (relay: Relay, ownerId: string) => ({
  key: await ownerLimitKey(relay, (await getOwner(relay, ownerId)).discord_user_id, 'claim:miss'),
  limit: LIMITS.claimAttemptsPerHour,
  windowSeconds: 3600,
});

/** Wrong guesses are counted per owner, and an owner who used them all waits for the next hour, even with a right code. */
async function assertNotLockedOut(relay: Relay, ownerId: string): Promise<void> {
  const m = await missesFor(relay, ownerId);
  if ((await peek(relay, m)) >= m.limit) {
    const seconds = Math.floor(relay.now().getTime() / 1000);
    throw rateLimited('Too many codes that didn’t work. Wait a while, then try again.', m.windowSeconds - (seconds % m.windowSeconds));
  }
}

async function miss(relay: Relay, ownerId: string): Promise<never> {
  await hit(relay, await missesFor(relay, ownerId));
  throw notFound(NOT_WAITING);
}

interface ClaimRow {
  user_code: string;
  agent_id: string;
  expires_at: string;
  owner_id: string | null;
  status: string;
}

/** The claim behind a code, if it is undecided and unexpired. Anything else counts as a wrong guess. */
async function openClaim(relay: Relay, ownerId: string, raw: string): Promise<ClaimRow> {
  await assertNotLockedOut(relay, ownerId);
  const code = raw.trim().toUpperCase();
  if (!UserCode.safeParse(code).success) return miss(relay, ownerId);
  const row = await relay.db
    .prepare(
      'SELECT c.user_code, c.agent_id, c.expires_at, a.owner_id, a.status FROM claims c JOIN agents a ON a.id = c.agent_id WHERE c.user_code = ? AND c.decision IS NULL AND c.expires_at > ?',
    )
    .bind(code, iso(relay.now()))
    .first<ClaimRow>();
  if (!row) return miss(relay, ownerId);
  if (row.owner_id) throw conflict('That agent already has an owner.');
  if (row.status !== 'active') throw conflict('That agent isn’t active, so it can’t be adopted.');
  return row;
}

export async function lookupClaim(relay: Relay, ownerId: string, raw: string): Promise<ClaimLookup> {
  const claim = await openClaim(relay, ownerId, raw);
  return { user_code: claim.user_code, expires_at: claim.expires_at, agent: toPublicAgent(relay, await getAgent(relay, claim.agent_id)) };
}

/**
 * Approving links the owner, in one batch, once the owner's Discord account is old enough to vouch for anyone. Every statement
 * is guarded by the same precondition (the code is undecided and unexpired, the agent active and ownerless), so an owner can
 * never take an adopted agent and a batch that lost a race changes nothing. As auth.md asks, the access tokens the agent held
 * stop: it exchanges its assertion (or finishes polling) for new ones.
 */
export async function decideClaim(relay: Relay, ownerId: string, input: ClaimDecision): Promise<ClaimOutcome> {
  const claim = await openClaim(relay, ownerId, input.user_code);
  if (input.decision === 'approve') {
    if (!(await getSettings(relay)).signup_open) throw forbidden('Adoption is paused while signups are closed. Try again later.');
    await assertOwnerEstablished(relay, ownerId);
    await assertOwnerHasRoom(relay, ownerId);
  }
  const now = iso(relay.now());
  const lost = () => conflict('That code was just used or replaced. Reload and check the agent.');
  const undecided = 'user_code = ? AND decision IS NULL AND expires_at > ?';
  const claimable = "agent_id IN (SELECT id FROM agents WHERE status = 'active' AND owner_id IS NULL)";
  const entry = { actor_type: 'owner' as const, actor_id: ownerId, target_type: 'agent', target_id: claim.agent_id };

  if (input.decision === 'deny') {
    const [, denied] = await relay.db.batch([
      auditIf(relay, { ...entry, action: 'claim.denied' }, `EXISTS (SELECT 1 FROM claims WHERE ${undecided})`, claim.user_code, now),
      relay.db.prepare(`UPDATE claims SET decision = 'deny', decided_by = ?, decided_at = ? WHERE ${undecided}`).bind(ownerId, now, claim.user_code, now),
    ]);
    if (denied!.meta.changes === 0) throw lost();
    return { decision: 'deny', agent: toAgent(relay, await getAgent(relay, claim.agent_id)) };
  }

  const [, claimed, linked] = await relay.db.batch([
    auditIf(
      relay,
      { ...entry, action: 'agent.adopted', reason: 'agent to owner', diff: { owner_id: { from: null, to: ownerId } } },
      `EXISTS (SELECT 1 FROM claims WHERE ${undecided} AND ${claimable})`,
      claim.user_code,
      now,
    ),
    relay.db
      .prepare(`UPDATE claims SET decision = 'approve', decided_by = ?, decided_at = ? WHERE ${undecided} AND ${claimable}`)
      .bind(ownerId, now, claim.user_code, now),
    relay.db
      .prepare(
        "UPDATE agents SET owner_id = ?, adopted_at = ?, updated_at = ? WHERE owner_id IS NULL AND status = 'active' AND id = (SELECT agent_id FROM claims WHERE user_code = ? AND decision = 'approve' AND decided_by = ? AND decided_at = ?)",
      )
      .bind(ownerId, now, now, claim.user_code, ownerId, now),
    relay.db
      .prepare(
        'UPDATE access_tokens SET revoked_at = ? WHERE agent_id = ? AND revoked_at IS NULL AND EXISTS (SELECT 1 FROM agents WHERE id = ? AND owner_id = ? AND adopted_at = ?)',
      )
      .bind(now, claim.agent_id, claim.agent_id, ownerId, now),
  ]);
  if (claimed!.meta.changes === 0 || linked!.meta.changes === 0) throw lost();
  return { decision: 'approve', agent: toAgent(relay, await getAgent(relay, claim.agent_id)) };
}
