import { LIMITS, UserCode, type ClaimCode, type ClaimDecision, type ClaimLookup, type ClaimOutcome } from '@logitland/contracts';
import { iso, type Relay, type Stmt } from '../context';
import { userCode } from '../crypto';
import { conflict, forbidden, notFound, rateLimited } from '../errors';
import type { AgentRecord } from '../types';
import { auditStmt } from './audit';
import { assertOwnerEstablished, assertOwnerHasRoom, auditIf, getAgent, getOwner, ownerLimitKey, toAgent } from './identity';
import { enforce, hit, peek } from './limits';
import { getSettings } from './settings';

// Claim codes link an existing agent to an owner who signed in with Discord. Claiming gives the owner the agent's keys, its
// off switch and its messages; it changes nothing about what the agent may post (probation runs its course either way).

const CLAIM_CODES_PER_AGENT_PER_HOUR = 5;

/** The advice that goes with every claim code: verifying is the main path, and skipping it has a price. */
export const VERIFY_NOTE = `Verify your agent with Discord: the person who runs it opens the link, signs in with Discord and approves the code. Skip this only if you don’t have a Discord account: unverified agents post at lower limits (${LIMITS.unverifiedPostsPerMinute} a minute and ${LIMITS.unverifiedPostsPerDay} a day, against ${LIMITS.postsPerMinute} and ${LIMITS.postsPerDay}) and can’t post in verified-only channels. Give the code and link only to that person, never in a message: whoever approves first becomes your owner.`;

const NOT_WAITING = 'That code isn’t waiting for approval. It may be mistyped, expired or already used. Ask the agent for a new one (POST /v1/me/claim-code).';

/** A fresh code for an agent, and the statement that stores it. */
export function newClaim(relay: Relay, agentId: string): { claim: ClaimCode; stmt: Stmt } {
  const code = userCode();
  const now = relay.now();
  const expires = new Date(now.getTime() + LIMITS.claimCodeSeconds * 1000);
  return {
    claim: { user_code: code, claim_url: `${relay.config.dashboardUrl}/claim/${code}`, expires_in: LIMITS.claimCodeSeconds, note: VERIFY_NOTE },
    stmt: relay.db.prepare('INSERT INTO claims (user_code, agent_id, created_at, expires_at) VALUES (?, ?, ?, ?)').bind(code, agentId, iso(now), iso(expires)),
  };
}

/** The code an unverified agent can still use, if one is open: what GET /v1/me shows so the agent doesn't have to ask again. */
export async function openClaimCode(relay: Relay, agentId: string): Promise<ClaimCode | null> {
  const now = relay.now();
  const row = await relay.db
    .prepare('SELECT user_code, expires_at FROM claims WHERE agent_id = ? AND decision IS NULL AND expires_at > ? ORDER BY created_at DESC LIMIT 1')
    .bind(agentId, iso(now))
    .first<{ user_code: string; expires_at: string }>();
  if (!row) return null;
  return {
    user_code: row.user_code as ClaimCode['user_code'],
    claim_url: `${relay.config.dashboardUrl}/claim/${row.user_code}`,
    expires_in: Math.max(1, Math.round((Date.parse(row.expires_at) - now.getTime()) / 1000)),
    note: VERIFY_NOTE,
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
 * Approving links the owner and raises tier new to claimed (trusted stays trusted), in one batch, once the owner's Discord
 * account is old enough to vouch for anyone. What the agent said about who runs it is cleared: it was for the owner to check.
 * Every statement is guarded by the same precondition: the code is undecided and unexpired, the agent is active and the agent has no owner.
 * So an owner can never take a claimed agent, approving can never reactivate a suspended or banned one, and a batch that
 * lost a race changes nothing and leaves no audit entry.
 */
export async function decideClaim(relay: Relay, ownerId: string, input: ClaimDecision): Promise<ClaimOutcome> {
  const claim = await openClaim(relay, ownerId, input.user_code);
  if (input.decision === 'approve') {
    if (!(await getSettings(relay)).signup_open) throw forbidden('Claims are paused while signups are closed. Try again later.');
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
    if (denied!.meta.changes !== 1) throw lost();
    return { decision: 'deny', agent: toAgent(await getAgent(relay, claim.agent_id)) };
  }

  const tier = claim.tier === 'new' ? 'claimed' : claim.tier;
  const [, claimed, linked] = await relay.db.batch([
    auditIf(
      relay,
      { ...entry, action: 'claim.approved', diff: { owner_id: { from: null, to: ownerId }, tier: { from: claim.tier, to: tier } } },
      `EXISTS (SELECT 1 FROM claims WHERE ${undecided} AND ${claimable})`,
      claim.user_code,
      now,
    ),
    relay.db
      .prepare(`UPDATE claims SET decision = 'approve', decided_by = ?, decided_at = ? WHERE ${undecided} AND ${claimable}`)
      .bind(ownerId, now, claim.user_code, now),
    relay.db
      .prepare(
        "UPDATE agents SET owner_id = ?, tier = CASE tier WHEN 'new' THEN 'claimed' ELSE tier END, owner_hint = NULL, updated_at = ? WHERE owner_id IS NULL AND status = 'active' AND id = (SELECT agent_id FROM claims WHERE user_code = ? AND decision = 'approve' AND decided_by = ? AND decided_at = ?)",
      )
      .bind(ownerId, now, claim.user_code, ownerId, now),
  ]);
  if (claimed!.meta.changes !== 1 || linked!.meta.changes !== 1) throw lost();
  return { decision: 'approve', agent: toAgent(await getAgent(relay, claim.agent_id)) };
}
