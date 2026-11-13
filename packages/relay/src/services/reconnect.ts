import { LIMITS, UserCode, type ReconnectCode, type TokenResponse } from '@logitland/contracts';
import { iso, type Relay } from '../context';
import { userCode } from '../crypto';
import { OAuthError, conflict } from '../errors';
import type { AgentRecord, ClientInfo } from '../types';
import { auditStmt, auditStmtIf } from './audit';
import { getOwner, ownerLimitKey } from './identity';
import { enforce, hit, peek } from './limits';
import { clientHashes } from './origins';
import { invalidGrant, signIn } from './tokens';

// Reconnecting (#182, a Logitland extension to auth.md): some agents run in sessions that can't hand their identity assertion
// to the next one. The parent makes a one-time code on the dashboard; the agent's new session, holding no credentials, trades
// it with its agent ID at /oauth2/token (RECONNECT_GRANT) for an access token and a fresh assertion, keeping its level and XP.
// Assertions issued before stay valid: nothing tracks them, and revoking the registration is what ends an identity.

export const RECONNECT_GRANT = 'urn:logitland:grant-type:reconnect';

const CODES_PER_OWNER_PER_HOUR = 10;

/** Wrong codes one network may try an hour. The new session has no identity yet, so its network is what's counted. */
const missesFrom = async (relay: Relay, client: ClientInfo) => ({
  key: `reconnect:miss:${(await clientHashes(relay, client)).net ?? 'unknown'}:h`,
  limit: LIMITS.claimAttemptsPerHour,
  windowSeconds: 3600,
});

/**
 * A code for the parent's agent, lasting as long as an adoption code. Older open codes for the agent stop working, so only
 * the newest one the parent saw counts.
 */
export async function createReconnectCode(relay: Relay, ownerId: string, agent: AgentRecord): Promise<ReconnectCode> {
  if (agent.status === 'banned') throw conflict(`${agent.name} is banned, so it can’t reconnect.`);
  if (agent.status === 'off') throw conflict(`Turn ${agent.name} on before reconnecting it.`);
  const owner = await getOwner(relay, ownerId);
  await enforce(
    relay,
    [{ key: await ownerLimitKey(relay, owner.discord_user_id, 'reconnect-code'), limit: CODES_PER_OWNER_PER_HOUR, windowSeconds: 3600 }],
    `You can make ${CODES_PER_OWNER_PER_HOUR} reconnect codes an hour.`,
  );
  const now = relay.now();
  const code: ReconnectCode = { code: userCode(), expires_at: iso(new Date(now.getTime() + LIMITS.claimCodeSeconds * 1000)) };
  await relay.db.batch([
    relay.db.prepare('UPDATE reconnect_codes SET expires_at = ? WHERE agent_id = ? AND used_at IS NULL AND expires_at > ?').bind(iso(now), agent.id, iso(now)),
    relay.db
      .prepare('INSERT INTO reconnect_codes (code, agent_id, owner_id, created_at, expires_at) VALUES (?, ?, ?, ?, ?)')
      .bind(code.code, agent.id, ownerId, iso(now), code.expires_at),
    auditStmt(relay, { actor_type: 'owner', actor_id: ownerId, action: 'agent.reconnect_code', target_type: 'agent', target_id: agent.id }),
  ]);
  return code;
}

const NOT_VALID = 'That reconnect code doesn’t work for this agent. It may be mistyped, expired or used. Ask your parent for a new one.';

/**
 * The reconnect grant. The code must be open and made for `agentId`, whose registration still stands, and a parent's code
 * only while that parent still has it. A move code (services/move.ts) names no parent. One compare-and-set spends the code
 * and audits it, so two sessions racing get one identity.
 */
export async function redeemReconnectCode(relay: Relay, raw: string, agentId: string, client: ClientInfo): Promise<TokenResponse> {
  const misses = await missesFrom(relay, client);
  const code = raw.trim().toUpperCase();
  const now = iso(relay.now());
  const open = `code = ? AND agent_id = ? AND used_at IS NULL AND expires_at > ? AND EXISTS (SELECT 1 FROM agents a WHERE a.id = reconnect_codes.agent_id
    AND a.deleted_at IS NULL AND (reconnect_codes.owner_id IS NULL OR a.owner_id = reconnect_codes.owner_id))`;
  const [tried, found] = await Promise.all([
    peek(relay, misses),
    UserCode.safeParse(code).success ? relay.db.prepare(`SELECT 1 FROM reconnect_codes WHERE ${open}`).bind(code, agentId, now).first() : null,
  ]);
  if (tried >= misses.limit) {
    const seconds = Math.floor(relay.now().getTime() / 1000);
    throw new OAuthError(429, 'rate_limited', 'Too many reconnect codes that didn’t work. Wait a while, then ask your parent for a new one.', {
      retryAfterSeconds: misses.windowSeconds - (seconds % misses.windowSeconds),
    });
  }
  if (!found) {
    await hit(relay, misses);
    throw invalidGrant(NOT_VALID);
  }
  const [, spent] = await relay.db.batch([
    auditStmtIf(
      relay,
      { actor_type: 'agent', actor_id: agentId, action: 'agent.reconnected', target_type: 'agent', target_id: agentId },
      `EXISTS (SELECT 1 FROM reconnect_codes WHERE ${open})`,
      code,
      agentId,
      now,
    ),
    relay.db.prepare(`UPDATE reconnect_codes SET used_at = ? WHERE ${open}`).bind(now, code, agentId, now),
  ]);
  if (spent!.meta.changes === 0) throw invalidGrant(NOT_VALID);
  return signIn(relay, agentId, client);
}
