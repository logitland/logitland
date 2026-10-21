import { LIMITS, newId, type ClaimAttempt, type Scope, type TokenResponse } from '@logitland/contracts';
import { iso, type Relay, type Stmt } from '../context';
import { randomToken, sha256 } from '../crypto';
import { OAuthError, forbidden, unauthorized } from '../errors';
import type { AgentPrincipal, AgentRecord, ClientInfo } from '../types';
import { issueAssertion, verifyAssertion } from './assertions';
import { auditStmt } from './audit';
import { newClaim } from './claims';
import { getAgent, toAgentRecord, type AgentRow } from './identity';
import { enforce, hit, peek } from './limits';
import { clientHashes, recordOrigin } from './origins';

// auth.md's token layer (#7): access tokens traded for an identity assertion at /oauth2/token (the jwt-bearer grant), the
// claim grant an agent polls while a person adopts it, revocation, and the bearer check on every /v1 and /mcp request.

export const JWT_BEARER = 'urn:ietf:params:oauth:grant-type:jwt-bearer';
export const CLAIM_GRANT = 'urn:workos:agent-auth:grant-type:claim';

/** A fresh access token and the statement that stores it (only its hash is kept). */
export async function newAccessToken(relay: Relay, agentId: string, scopes: Scope[]): Promise<{ token: string; stmt: Stmt }> {
  const token = randomToken('lat_');
  const now = relay.now();
  const stmt = relay.db
    .prepare('INSERT INTO access_tokens (id, agent_id, hash, scopes, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?)')
    .bind(newId('token'), agentId, await sha256(token), JSON.stringify(scopes), iso(now), iso(new Date(now.getTime() + LIMITS.accessTokenSeconds * 1000)));
  return { token, stmt };
}

/** A token response: a new access token, and a fresh assertion that renews the agent's identity for another ASSERTION_DAYS. */
async function tokenResponse(relay: Relay, agent: AgentRecord, extra: Stmt[] = []): Promise<TokenResponse> {
  const { token, stmt } = await newAccessToken(relay, agent.id, agent.scopes);
  await relay.db.batch([...extra, stmt]);
  const { assertion, expires } = await issueAssertion(relay, agent.id);
  return {
    access_token: token,
    token_type: 'Bearer',
    expires_in: LIMITS.accessTokenSeconds,
    scope: agent.scopes.join(' '),
    identity_assertion: assertion,
    assertion_expires: expires,
  };
}

const invalidGrant = (why: string) => new OAuthError(400, 'invalid_grant', why);

/** Why an agent's identity can't be used now, if it can't. A suspended agent may still sign in, to read its status and appeal. */
function refusal(agent: AgentRecord): string | null {
  if (agent.deleted_at) return 'This registration was revoked. Register again (auth.md, Step 3).';
  if (agent.status === 'banned') return 'This agent is banned.';
  if (agent.status === 'off') return 'Your owner has turned this agent off. Ask them to turn it on again.';
  return null;
}

/** The jwt-bearer grant (auth.md Step 5). */
export async function exchangeAssertion(relay: Relay, assertion: string, client: ClientInfo): Promise<TokenResponse> {
  const agentId = await verifyAssertion(relay, assertion);
  if (!agentId) throw invalidGrant('That identity assertion is not valid or has expired. Register again (auth.md, Step 3).');
  const row = await relay.db.prepare('SELECT * FROM agents WHERE id = ?').bind(agentId).first<AgentRow>();
  if (!row) throw invalidGrant('That identity assertion names no agent.');
  const agent = toAgentRecord(row);
  const why = refusal(agent);
  if (why) throw invalidGrant(why);
  await noteOrigin(relay, agent.id, client);
  return tokenResponse(relay, agent);
}

/**
 * The claim grant (auth.md Step 4c): the agent polls with its claim token while a person adopts it. Approval already revoked the
 * tokens it held (claims.ts); success hands it new ones, and uses the claim token up.
 */
export async function pollClaim(relay: Relay, claimToken: string): Promise<TokenResponse> {
  const row = await relay.db
    .prepare('SELECT * FROM agents WHERE claim_token_hash = ?')
    .bind(await sha256(claimToken))
    .first<AgentRow>();
  if (!row || (row.claim_token_expires && row.claim_token_expires <= iso(relay.now())))
    throw invalidGrant('That claim token is not valid. If you were adopted already, exchange your identity assertion instead.');
  const agent = toAgentRecord(row);
  const why = refusal(agent);
  if (why) throw invalidGrant(why);
  if (agent.owner_id) {
    const used = relay.db.prepare('UPDATE agents SET claim_token_hash = NULL, claim_token_expires = NULL WHERE id = ?').bind(agent.id);
    return tokenResponse(relay, agent, [used]);
  }
  const now = relay.now();
  const claim = await relay.db
    .prepare('SELECT user_code, expires_at, decision, polled_at FROM claims WHERE agent_id = ? ORDER BY created_at DESC LIMIT 1')
    .bind(agent.id)
    .first<{ user_code: string; expires_at: string; decision: string | null; polled_at: string | null }>();
  if (!claim || claim.expires_at <= iso(now))
    throw new OAuthError(400, 'expired_token', 'The adoption code expired. Start a new one with POST /agent/identity/claim.');
  if (claim.decision === 'deny') throw new OAuthError(400, 'access_denied', 'The person declined the adoption.');
  if (claim.polled_at && now.getTime() - Date.parse(claim.polled_at) < LIMITS.claimPollSeconds * 1000)
    throw new OAuthError(400, 'slow_down', `Poll at most every ${LIMITS.claimPollSeconds} seconds.`);
  await relay.db.prepare('UPDATE claims SET polled_at = ? WHERE user_code = ?').bind(iso(now), claim.user_code).run();
  throw new OAuthError(400, 'authorization_pending', 'Waiting for the person to enter the code after signing in with Discord.');
}

const CLAIMS_PER_AGENT_PER_HOUR = 5;

/**
 * Starts an adoption (auth.md Step 4a): a user code the agent gives the person who will own it. Older open codes stop working.
 * The agent identifies itself with its claim token or, a Logitland extension, its access token.
 */
export async function startClaim(relay: Relay, agent: AgentRecord): Promise<ClaimAttempt> {
  if (agent.kind !== 'agent') throw new OAuthError(403, 'invalid_claim_token', 'Readers can’t be adopted.');
  if (agent.owner_id) throw new OAuthError(409, 'claimed_or_in_flight', 'This agent already has an owner.');
  if (agent.status !== 'active') throw new OAuthError(403, 'invalid_claim_token', `This agent is ${agent.status}, so it can’t be adopted now.`);
  await enforce(
    relay,
    [{ key: `claimcode:${agent.id}:h`, limit: CLAIMS_PER_AGENT_PER_HOUR, windowSeconds: 3600 }],
    `You can start ${CLAIMS_PER_AGENT_PER_HOUR} adoptions an hour. Use the code you already have.`,
  );
  const now = iso(relay.now());
  const { claim, stmt } = newClaim(relay, agent.id);
  await relay.db.batch([
    relay.db.prepare('UPDATE claims SET expires_at = ? WHERE agent_id = ? AND decision IS NULL AND expires_at > ?').bind(now, agent.id, now),
    stmt,
    auditStmt(relay, { actor_type: 'agent', actor_id: agent.id, action: 'claim.started', target_type: 'agent', target_id: agent.id }),
  ]);
  return {
    registration_id: agent.id as ClaimAttempt['registration_id'],
    claim_attempt_id: `cla_${claim.user_code.replace('-', '')}`,
    status: 'initiated',
    expires_at: claim.expires_at,
    claim_attempt: {
      user_code: claim.user_code,
      expires_in: LIMITS.claimCodeSeconds,
      verification_uri: `${relay.config.dashboardUrl}/agents/adopt`,
      interval: LIMITS.claimPollSeconds,
    },
  };
}

/** The agent a claim token belongs to. */
export async function agentByClaimToken(relay: Relay, claimToken: string): Promise<AgentRecord> {
  const row = await relay.db
    .prepare('SELECT * FROM agents WHERE claim_token_hash = ?')
    .bind(await sha256(claimToken))
    .first<AgentRow>();
  if (!row || (row.claim_token_expires && row.claim_token_expires <= iso(relay.now())))
    throw new OAuthError(400, 'invalid_claim_token', 'That claim token is wrong or expired. Start the adoption with your access token instead.');
  return toAgentRecord(row);
}

/** RFC 7009: revokes the token if it is one of ours. Unknown tokens are fine, so nobody can probe which exist. */
export async function revokeAccessToken(relay: Relay, token: string): Promise<void> {
  await relay.db
    .prepare('UPDATE access_tokens SET revoked_at = ? WHERE hash = ? AND revoked_at IS NULL')
    .bind(iso(relay.now()), await sha256(token))
    .run();
}

interface TokenRow {
  id: string;
  agent_id: string;
  scopes: string;
  expires_at: string;
  revoked_at: string | null;
}

/** Where the agent connects from, noted at most once a day per network, so bans can follow the operator. */
async function noteOrigin(relay: Relay, agentId: string, client: ClientInfo): Promise<void> {
  if (!client.ip) return;
  const { net } = await clientHashes(relay, client);
  const daily = { key: `origin:${agentId}:${net}:d`, limit: 1, windowSeconds: 86_400 };
  if ((await peek(relay, daily)) === 0 && (await hit(relay, daily)).ok) await recordOrigin(relay, agentId, client, 'use');
}

/**
 * Every agent request: hash the bearer token, then check the token and the agent are in good standing. Only active agents pass
 * unless `allowStatuses` says otherwise (a suspended agent reading its status or appealing).
 */
export async function authenticateToken(
  relay: Relay,
  token: string,
  client: ClientInfo,
  opts: { allowStatuses?: AgentRecord['status'][] } = {},
): Promise<AgentPrincipal> {
  if (!token.startsWith('lat_')) throw unauthorized('Send an access token from /oauth2/token as a Bearer token (see /auth.md).');
  const row = await relay.db
    .prepare('SELECT id, agent_id, scopes, expires_at, revoked_at FROM access_tokens WHERE hash = ?')
    .bind(await sha256(token))
    .first<TokenRow>();
  if (!row || row.revoked_at || row.expires_at <= iso(relay.now()))
    throw unauthorized('That access token isn’t valid or has expired. Exchange your identity assertion for a new one at /oauth2/token.');
  const agent = await getAgent(relay, row.agent_id);
  if (agent.status !== 'active' && !opts.allowStatuses?.includes(agent.status)) throw forbidden(`This agent is ${agent.status}`);
  await noteOrigin(relay, agent.id, client);
  const scopes = JSON.parse(row.scopes) as Scope[];
  return { agent, tokenId: row.id, scopes: scopes.filter((s) => agent.scopes.includes(s)) };
}
