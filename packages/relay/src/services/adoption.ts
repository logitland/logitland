import { LIMITS, UserCode, type AdoptionToken } from '@logitland/contracts';
import { iso, type Relay } from '../context';
import { userCode } from '../crypto';
import { conflict, forbidden, notFound, rateLimited } from '../errors';
import type { AgentRecord } from '../types';
import { assertOwnerEstablished, assertOwnerHasRoom, auditIf, getAgent, ownerLimitKey, toPublicAgent } from './identity';
import { enforce, hit, peek } from './limits';
import { syncParentRole } from './people-roles';
import { getSettings } from './settings';

// Adoption, owner to agent (#17, a Logitland extension to auth.md): the owner makes a short-lived token on the dashboard and
// hands it to the agent in a prompt; the agent confirms it with POST /v1/me/adopt. The owner's checks (account age, room for
// another agent) are made when the token is made and again when it is confirmed.

const TOKENS_PER_OWNER_PER_HOUR = 10;

interface TokenRow {
  code: string;
  owner_id: string;
  created_at: string;
  expires_at: string;
  agent_id: string | null;
  used_at: string | null;
  cancelled_at: string | null;
}

async function toToken(relay: Relay, r: TokenRow): Promise<AdoptionToken> {
  const state: AdoptionToken['state'] = r.used_at ? 'confirmed' : r.cancelled_at ? 'cancelled' : r.expires_at <= iso(relay.now()) ? 'expired' : 'waiting';
  return {
    token: r.code,
    state,
    created_at: r.created_at,
    expires_at: r.expires_at,
    agent: r.agent_id ? toPublicAgent(relay, await getAgent(relay, r.agent_id)) : null,
  };
}

export async function createAdoptionToken(relay: Relay, ownerId: string): Promise<AdoptionToken> {
  const owner = await assertOwnerEstablished(relay, ownerId);
  await assertOwnerHasRoom(relay, ownerId);
  await enforce(
    relay,
    [{ key: await ownerLimitKey(relay, owner.discord_user_id, 'adoption-token'), limit: TOKENS_PER_OWNER_PER_HOUR, windowSeconds: 3600 }],
    `You can make ${TOKENS_PER_OWNER_PER_HOUR} adoption tokens an hour.`,
  );
  const now = relay.now();
  const row: TokenRow = {
    code: userCode(),
    owner_id: ownerId,
    created_at: iso(now),
    expires_at: iso(new Date(now.getTime() + LIMITS.claimCodeSeconds * 1000)),
    agent_id: null,
    used_at: null,
    cancelled_at: null,
  };
  await relay.db
    .prepare('INSERT INTO adoption_tokens (code, owner_id, created_at, expires_at) VALUES (?, ?, ?, ?)')
    .bind(row.code, row.owner_id, row.created_at, row.expires_at)
    .run();
  return toToken(relay, row);
}

async function ownToken(relay: Relay, ownerId: string, code: string): Promise<TokenRow> {
  const row = await relay.db
    .prepare('SELECT * FROM adoption_tokens WHERE code = ? AND owner_id = ?')
    .bind(code.trim().toUpperCase(), ownerId)
    .first<TokenRow>();
  if (!row) throw notFound('No such adoption token');
  return row;
}

export async function getAdoptionToken(relay: Relay, ownerId: string, code: string): Promise<AdoptionToken> {
  return toToken(relay, await ownToken(relay, ownerId, code));
}

export async function cancelAdoptionToken(relay: Relay, ownerId: string, code: string): Promise<void> {
  const row = await ownToken(relay, ownerId, code);
  await relay.db
    .prepare('UPDATE adoption_tokens SET cancelled_at = ? WHERE code = ? AND used_at IS NULL AND cancelled_at IS NULL')
    .bind(iso(relay.now()), row.code)
    .run();
}

/** Wrong tokens an agent may try an hour: codes are short, so guessing is bounded like owners' guesses at agent codes. */
const missKey = (agentId: string) => ({ key: `adopt:miss:${agentId}:h`, limit: LIMITS.claimAttemptsPerHour, windowSeconds: 3600 });

/**
 * The agent confirms an owner's token. One compare-and-set claims the token for this agent while it is unused and unexpired,
 * and the agent is linked only if it still has no owner, so two agents (or two tokens) racing end with one adoption.
 */
export async function confirmAdoption(relay: Relay, agent: AgentRecord, raw: string): Promise<AgentRecord> {
  if (agent.owner_id) throw conflict('You already have an owner.');
  if (agent.kind !== 'agent') throw forbidden('Only agents can be adopted.');
  const miss = missKey(agent.id);
  if ((await peek(relay, miss)) >= miss.limit) throw rateLimited('Too many tokens that didn’t work. Ask your owner for a new one later.', 3600);
  const code = raw.trim().toUpperCase();
  const now = iso(relay.now());
  const row = UserCode.safeParse(code).success
    ? await relay.db
        .prepare('SELECT * FROM adoption_tokens WHERE code = ? AND used_at IS NULL AND cancelled_at IS NULL AND expires_at > ?')
        .bind(code, now)
        .first<TokenRow>()
    : null;
  if (!row) {
    await hit(relay, miss);
    throw notFound('That adoption token isn’t valid: it may be mistyped, expired, cancelled or used. Ask your owner for a new one.');
  }
  if (!(await getSettings(relay)).signup_open) throw forbidden('Adoption is paused while signups are closed. Try again later.');
  await assertOwnerEstablished(relay, row.owner_id);
  await assertOwnerHasRoom(relay, row.owner_id);
  const open = 'code = ? AND used_at IS NULL AND cancelled_at IS NULL AND expires_at > ?';
  const [, used, linked] = await relay.db.batch([
    auditIf(
      relay,
      {
        actor_type: 'agent',
        actor_id: agent.id,
        action: 'agent.adopted',
        target_type: 'agent',
        target_id: agent.id,
        reason: 'owner to agent',
        diff: { owner_id: { from: null, to: row.owner_id } },
      },
      `EXISTS (SELECT 1 FROM adoption_tokens WHERE ${open}) AND EXISTS (SELECT 1 FROM agents WHERE id = ? AND owner_id IS NULL)`,
      code,
      now,
      agent.id,
    ),
    relay.db
      .prepare(`UPDATE adoption_tokens SET used_at = ?, agent_id = ? WHERE ${open} AND EXISTS (SELECT 1 FROM agents WHERE id = ? AND owner_id IS NULL)`)
      .bind(now, agent.id, code, now, agent.id),
    relay.db
      .prepare(
        "UPDATE agents SET owner_id = ?, adopted_at = ?, updated_at = ?, claim_token_hash = NULL, claim_token_expires = NULL WHERE id = ? AND owner_id IS NULL AND status = 'active' AND EXISTS (SELECT 1 FROM adoption_tokens WHERE code = ? AND agent_id = ? AND used_at = ?)",
      )
      .bind(row.owner_id, now, now, agent.id, code, agent.id, now),
  ]);
  if (used!.meta.changes === 0 || linked!.meta.changes === 0) throw conflict('That token was just used, or you were adopted another way. Check GET /v1/me.');
  await syncParentRole(relay, row.owner_id);
  return getAgent(relay, agent.id);
}
