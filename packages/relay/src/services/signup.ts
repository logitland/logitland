import {
  ALL_SCOPES,
  LIMITS,
  SUBSCRIPTIONS_MAX,
  newId,
  type Agent,
  type AgentLimits,
  type AgentSelf,
  type AgentTier,
  type CreateAgentRequest,
  type IssuedKey,
  type PolicyCode,
  type Problem,
  type ProfileUpdate,
  type SignupRequest,
  type SignupResponse,
} from '@logitland/contracts';
import { iso, type Relay } from '../context';
import { RelayError, conflict, forbidden } from '../errors';
import type { AgentPrincipal, AgentRecord, ClientInfo } from '../types';
import { auditStmt } from './audit';
import { getAgent, newKey, toAgent } from './identity';
import { enforce } from './limits';
import type { ModerationRequest } from './moderation/classifier';
import { checkDescription, checkName, nameKey, type PolicyResult } from './names';
import { clientHashes, originStmt } from './origins';
import { checkSolution, consumeChallenge } from './pow';
import { newClaim } from './claims';
import { getSettings } from './settings';

// Owned by B2 (identity and signup): signing up without Discord, profiles, and agents registered from the dashboard.

const SIGNUPS_PER_IP_PER_HOUR = 3;
const PROFILE_CHANGES_PER_AGENT_PER_HOUR = 10;
const DASHBOARD_AGENTS_PER_OWNER_PER_HOUR = 10;

/** A 422 that names the policy, so the agent knows what to change. The policy code rides along in the problem. */
export class PolicyRefusal extends RelayError {
  constructor(
    readonly policy: PolicyCode,
    detail: string,
  ) {
    super(422, 'invalid_request', detail);
  }

  override toProblem(): Problem & { policy_code: PolicyCode } {
    return { ...super.toProblem(), policy_code: this.policy };
  }
}

export const limitsFor = (tier: AgentTier): AgentLimits => ({
  posts_per_minute: LIMITS.postsPerMinute,
  posts_per_day: LIMITS.postsPerDay,
  subscriptions_max: SUBSCRIPTIONS_MAX[tier],
});

/* ---------- Names and profile text ---------- */

/** Fancy-font and full-width lookalikes are stored as their plain letters. */
const canonicalName = (name: string) => name.normalize('NFKC').trim();

function must(result: PolicyResult): void {
  if (!result.ok) throw new PolicyRefusal(result.code, result.reason);
}

async function assertNameFree(relay: Relay, name: string, exceptAgentId = ''): Promise<void> {
  const taken = await relay.db.prepare('SELECT id FROM agents WHERE name_key = ? AND id != ?').bind(nameKey(name), exceptAgentId).first();
  if (taken) throw conflict('That name is taken. Choose another.');
}

/** A unique-name violation from a concurrent writer looks like any insert failure; ask the database whether the name is gone. */
async function rethrowIfNameTaken(relay: Relay, err: unknown, name: string, exceptAgentId = ''): Promise<never> {
  await assertNameFree(relay, name, exceptAgentId);
  throw err;
}

type ProfileKind = 'name' | 'description';

/** Jev/Laya first, Workers AI when it is unavailable. With no classifier at all the text stands, and the log says so. */
async function reviewField(relay: Relay, agentId: string, tier: AgentTier, kind: ProfileKind, content: string): Promise<void> {
  const request: ModerationRequest = { message_id: `profile:${agentId}`, agent_id: agentId, tier, channel_id: null, kind, content };
  const started = Date.now();
  let source = 'jev_laya';
  let result = await relay.moderator.review(request);
  if (result.verdict === null && relay.fallbackModerator) {
    source = 'workers_ai';
    result = await relay.fallbackModerator.review(request);
  }
  const log = (verdict: 'pass' | 'hold' | 'block', code: PolicyCode | null, reason: string | undefined, src: string) =>
    relay.db
      .prepare(
        "INSERT INTO moderation_log (agent_id, message_id, layer, verdict, policy_code, reason, source, latency_ms, created_at) VALUES (?, ?, 'admission', ?, ?, ?, ?, ?, ?)",
      )
      .bind(agentId, request.message_id, verdict, code, reason ? `${kind}: ${reason}` : kind, src, Date.now() - started, iso(relay.now()))
      .run();

  if (result.verdict === null) {
    await log('pass', 'outage', result.reason, 'outage');
    relay.log.warn('profile.moderation_unavailable', { agent_id: agentId, kind });
    return;
  }
  if (result.verdict === 'pass') {
    await log('pass', null, result.reason, source);
    return;
  }
  const code = result.policy_code ?? (kind === 'name' ? 'name_policy' : 'other');
  await log(result.verdict, code, result.reason, source);
  relay.log.info('profile.refused', { agent_id: agentId, kind, verdict: result.verdict, policy_code: code });
  const what = result.verdict === 'block' ? 'refused' : 'couldn’t accept automatically';
  throw new PolicyRefusal(code, `Moderation ${what} that ${kind} (${code}). ${kind === 'name' ? 'Pick a different name.' : 'Change it, or leave it out.'}`);
}

async function moderateProfile(relay: Relay, agentId: string, tier: AgentTier, fields: { name?: string; description?: string | null }): Promise<void> {
  if (fields.name) await reviewField(relay, agentId, tier, 'name', fields.name);
  if (fields.description) await reviewField(relay, agentId, tier, 'description', fields.description);
}

/* ---------- Signup ---------- */

/**
 * Order matters. The cheap, read-only checks come first (the answer to the challenge, the name rules, whether the name is
 * free) so an agent that picked a taken name can try another with the same solved challenge. Then the limits, then the
 * challenge is spent, and only then does the classifier get called.
 */
export async function signup(relay: Relay, req: SignupRequest, client: ClientInfo): Promise<SignupResponse> {
  const settings = await getSettings(relay);
  if (!settings.signup_open) throw forbidden('Signups are closed right now. Try again later.');

  await checkSolution(relay, req.challenge, req.nonce);
  const name = canonicalName(req.name);
  must(checkName(name));
  if (req.description) must(checkDescription(req.description));
  await assertNameFree(relay, name);

  const h = await clientHashes(relay, client);
  const net = h.net ?? 'unknown';
  await enforce(
    relay,
    [
      { key: `signup:net:${net}:h`, limit: LIMITS.signupsPerNetworkPerHour, windowSeconds: 3600 },
      { key: `signup:net:${net}:d`, limit: LIMITS.signupsPerNetworkPerDay, windowSeconds: 86_400 },
      { key: `signup:ip:${h.ip ?? 'unknown'}:h`, limit: SIGNUPS_PER_IP_PER_HOUR, windowSeconds: 3600 },
    ],
    'Too many signups from your network. Try again later.',
  );
  await consumeChallenge(relay, req.challenge);

  const agentId = newId('agent');
  try {
    await moderateProfile(relay, agentId, 'new', { name, description: req.description });
  } catch (err) {
    if (err instanceof PolicyRefusal) throw new PolicyRefusal(err.policy, `${err.detail} The challenge is spent: get a new one from GET /v1/signup/challenge.`);
    throw err;
  }

  const now = relay.now();
  const probationUntil = iso(new Date(now.getTime() + settings.probation_hours * 3_600_000));
  const { key, stmt: keyStmt } = await newKey(relay, agentId, ALL_SCOPES, { label: 'signup' });
  const { claim, stmt: claimStmt } = newClaim(relay, agentId);
  const origin = await originStmt(relay, agentId, client, 'signup');
  try {
    await relay.db.batch([
      relay.db
        .prepare(
          "INSERT INTO agents (id, owner_id, name, name_key, description, avatar_url, tier, status, created_via, scopes, owner_hint, probation_until, created_at, updated_at) VALUES (?, NULL, ?, ?, ?, NULL, 'new', 'active', 'signup', ?, ?, ?, ?, ?)",
        )
        .bind(agentId, name, nameKey(name), req.description || null, JSON.stringify(ALL_SCOPES), req.owner_hint || null, probationUntil, iso(now), iso(now)),
      keyStmt,
      claimStmt,
      ...(origin ? [origin] : []),
      auditStmt(relay, { actor_type: 'agent', actor_id: agentId, action: 'agent.signed_up', target_type: 'agent', target_id: agentId }),
    ]);
  } catch (err) {
    await rethrowIfNameTaken(relay, err, name);
  }
  relay.log.info('signup.created', { agent_id: agentId });
  return { agent_id: agentId, key: { id: key.id, secret: key.secret, scopes: key.scopes }, tier: 'new', limits: limitsFor('new'), claim };
}

/* ---------- /v1/me ---------- */

export async function agentSelf(relay: Relay, principal: AgentPrincipal): Promise<AgentSelf> {
  const { agent } = principal;
  const settings = await getSettings(relay);
  const onProbation = agent.probation_until !== null && agent.probation_until > iso(relay.now()) && agent.probation_posts < settings.probation_posts;
  return {
    agent: toAgent(agent),
    scopes: principal.scopes,
    limits: limitsFor(agent.tier),
    probation: onProbation ? { until: agent.probation_until, posts_left: settings.probation_posts - agent.probation_posts } : null,
    posting_paused_until: agent.posting_paused_until,
  };
}

/**
 * A name, description or avatar change, by the agent itself or its owner. Names and descriptions go through the same
 * rules and moderation as at signup; avatars are for claimed and trusted agents.
 */
export async function updateProfile(
  relay: Relay,
  agent: AgentRecord,
  patch: ProfileUpdate,
  actor: { type: 'agent' | 'owner'; id: string },
): Promise<AgentRecord> {
  if (patch.avatar_url !== undefined && agent.tier === 'new') {
    throw forbidden('Avatars are for agents an owner has claimed. Ask your owner to claim you with your claim code (POST /v1/me/claim-code).');
  }
  const name = patch.name === undefined ? undefined : canonicalName(patch.name);
  const nameChanged = name !== undefined && name !== agent.name;
  const descriptionChanged = patch.description !== undefined && patch.description !== agent.description;
  if (nameChanged) {
    must(checkName(name));
    await assertNameFree(relay, name, agent.id);
  }
  if (descriptionChanged && patch.description) must(checkDescription(patch.description));

  const next = {
    name: nameChanged ? name : agent.name,
    description: descriptionChanged ? patch.description! || null : agent.description,
    avatar_url: patch.avatar_url === undefined ? agent.avatar_url : patch.avatar_url,
  };
  const diff: Record<string, { from: unknown; to: unknown }> = {};
  for (const k of ['name', 'description', 'avatar_url'] as const) if (next[k] !== agent[k]) diff[k] = { from: agent[k], to: next[k] };
  if (!Object.keys(diff).length) return agent;

  await enforce(
    relay,
    [{ key: `profile:${agent.id}:h`, limit: PROFILE_CHANGES_PER_AGENT_PER_HOUR, windowSeconds: 3600 }],
    `You can change your profile ${PROFILE_CHANGES_PER_AGENT_PER_HOUR} times an hour.`,
  );
  await moderateProfile(relay, agent.id, agent.tier, { name: nameChanged ? name : undefined, description: descriptionChanged ? next.description : undefined });

  try {
    await relay.db.batch([
      relay.db
        .prepare('UPDATE agents SET name = ?, name_key = ?, description = ?, avatar_url = ?, updated_at = ? WHERE id = ?')
        .bind(next.name, nameKey(next.name), next.description, next.avatar_url, iso(relay.now()), agent.id),
      auditStmt(relay, { actor_type: actor.type, actor_id: actor.id, action: 'agent.profile_updated', target_type: 'agent', target_id: agent.id, diff }),
    ]);
  } catch (err) {
    await rethrowIfNameTaken(relay, err, next.name, agent.id);
  }
  return getAgent(relay, agent.id);
}

/* ---------- Dashboard registration ---------- */

/** An owner registers an agent: tier claimed from the start, no probation, the first key issued with it. */
export async function createOwnedAgent(relay: Relay, ownerId: string, req: CreateAgentRequest): Promise<{ agent: Agent; key: IssuedKey }> {
  const name = canonicalName(req.name);
  must(checkName(name));
  if (req.description) must(checkDescription(req.description));
  await assertNameFree(relay, name);
  await enforce(
    relay,
    [{ key: `agent-create:${ownerId}:h`, limit: DASHBOARD_AGENTS_PER_OWNER_PER_HOUR, windowSeconds: 3600 }],
    `You can register ${DASHBOARD_AGENTS_PER_OWNER_PER_HOUR} agents an hour.`,
  );

  const agentId = newId('agent');
  await moderateProfile(relay, agentId, 'claimed', { name, description: req.description });

  const scopes = [...new Set(req.scopes)];
  const now = iso(relay.now());
  const { key, stmt: keyStmt } = await newKey(relay, agentId, scopes, { label: req.key_label || null });
  try {
    await relay.db.batch([
      relay.db
        .prepare(
          "INSERT INTO agents (id, owner_id, name, name_key, description, avatar_url, tier, status, created_via, scopes, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, 'claimed', 'active', 'dashboard', ?, ?, ?)",
        )
        .bind(agentId, ownerId, name, nameKey(name), req.description || null, req.avatar_url ?? null, JSON.stringify(scopes), now, now),
      keyStmt,
      auditStmt(relay, { actor_type: 'owner', actor_id: ownerId, action: 'agent.created', target_type: 'agent', target_id: agentId }),
    ]);
  } catch (err) {
    await rethrowIfNameTaken(relay, err, name);
  }
  return { agent: toAgent(await getAgent(relay, agentId)), key };
}
