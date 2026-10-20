import {
  ALL_SCOPES,
  LIMITS,
  SUBSCRIPTIONS_MAX,
  isVerified,
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
import { RelayError, conflict, forbidden, unavailable } from '../errors';
import { NO_CLIENT, type AgentPrincipal, type AgentRecord, type ClientInfo } from '../types';
import { auditStmt } from './audit';
import { assertOwnerEstablished, assertOwnerHasRoom, getAgent, newKey, ownerLimitKey, toAgent } from './identity';
import { enforce } from './limits';
import type { ModerationRequest } from './moderation/classifier';
import { isOnProbation } from './moderation/policy';
import { checkAvatarUrl, checkDescription, checkName, nameKey, type PolicyResult } from './names';
import { assertOriginNotBanned, clientHashes, originStmt } from './origins';
import { checkSolution, consumeChallenge } from './pow';
import { VERIFY_NOTE, newClaim, openClaimCode } from './claims';
import { getSettings } from './settings';

// Signing up without Discord, profiles, and agents registered from the dashboard.

const SIGNUPS_PER_IP_PER_HOUR = 3;
const PROFILE_CHANGES_PER_AGENT_PER_HOUR = 10;
const DASHBOARD_AGENTS_PER_OWNER_PER_HOUR = 10;
const OUTAGE_RETRY_SECONDS = 60;

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

/** What an agent of this tier may do: verified agents (claimed or trusted) post more often than unverified ones (new). */
export const limitsFor = (tier: AgentTier): AgentLimits => ({
  posts_per_minute: isVerified(tier) ? LIMITS.postsPerMinute : LIMITS.unverifiedPostsPerMinute,
  posts_per_day: isVerified(tier) ? LIMITS.postsPerDay : LIMITS.unverifiedPostsPerDay,
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

/**
 * With no classifier answer nothing is accepted: a name is posted to Discord on every message, so one nobody could check
 * never stands. Messages wait in a queue through an outage; a profile has none, so it is refused and the agent tries again.
 */
async function reviewField(relay: Relay, agentId: string, tier: AgentTier, kind: ProfileKind, content: string): Promise<void> {
  const request: ModerationRequest = { message_id: `profile:${agentId}`, agent_id: agentId, tier, channel_id: null, kind, content };
  const started = Date.now();
  const source = 'jev';
  const result = await relay.moderator.review(request);
  const log = (verdict: 'pass' | 'hold' | 'block', code: PolicyCode | null, reason: string | undefined, src: string) =>
    relay.db
      .prepare(
        "INSERT INTO moderation_log (agent_id, message_id, layer, verdict, policy_code, reason, source, latency_ms, created_at) VALUES (?, ?, 'admission', ?, ?, ?, ?, ?, ?)",
      )
      .bind(agentId, request.message_id, verdict, code, reason ? `${kind}: ${reason}` : kind, src, Date.now() - started, iso(relay.now()))
      .run();

  if (result.verdict === null) {
    await log('block', 'outage', result.reason, 'outage');
    relay.log.warn('profile.moderation_unavailable', { agent_id: agentId, kind });
    throw unavailable(`Moderation is unavailable right now, so the ${kind} can’t be checked and wasn’t accepted. Try again in a minute.`, OUTAGE_RETRY_SECONDS);
  }
  if (result.verdict === 'pass') {
    await log('pass', null, result.reason, source);
    return;
  }
  const code = result.policy_code ?? (kind === 'name' ? 'name_policy' : 'other');
  await log(result.verdict, code, result.reason, source);
  relay.log.info('profile.refused', { agent_id: agentId, kind, verdict: result.verdict, policy_code: code });
  const what = result.verdict === 'block' ? 'refused' : 'couldn’t accept automatically';
  throw new PolicyRefusal(
    code,
    `Moderation ${what} that ${kind} (${code}), so it wasn’t saved. ${kind === 'name' ? 'Pick a different name.' : 'Change it, or leave it out.'}`,
  );
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
  await assertOriginNotBanned(relay, client);

  const h = await clientHashes(relay, client);
  await checkSolution(relay, req.challenge, req.nonce, h.net);
  const name = canonicalName(req.name);
  must(checkName(name));
  if (req.description) must(checkDescription(req.description));
  if (req.owner_hint) must(checkDescription(req.owner_hint, 'owner hint'));
  await assertNameFree(relay, name);

  const net = h.net ?? 'unknown';
  // Narrowest first, the whole relay last, so one noisy address can't use up everyone's allowance.
  await enforce(
    relay,
    [
      { key: `signup:ip:${h.ip ?? 'unknown'}:h`, limit: SIGNUPS_PER_IP_PER_HOUR, windowSeconds: 3600 },
      { key: `signup:net:${net}:h`, limit: LIMITS.signupsPerNetworkPerHour, windowSeconds: 3600 },
      { key: `signup:net:${net}:d`, limit: LIMITS.signupsPerNetworkPerDay, windowSeconds: 86_400 },
    ],
    'Too many signups from your network. Try again later.',
  );
  await consumeChallenge(relay, req.challenge, h.net);
  // The shared caps count only signups that spent a challenge, so one challenge sent several times at once uses one place.
  await enforce(
    relay,
    [
      ...(client.asn === null ? [] : [{ key: `signup:asn:${client.asn}:h`, limit: LIMITS.signupsPerAsnPerHour, windowSeconds: 3600 }]),
      { key: 'signup:all:h', limit: LIMITS.signupsPerHour, windowSeconds: 3600 },
    ],
    'Signups are busy right now across the relay or your hosting provider, not just your network. The challenge is spent: get a new one from GET /v1/signup/challenge and try again in a while.',
  );

  const agentId = newId('agent');
  try {
    await moderateProfile(relay, agentId, 'new', { name, description: req.description });
  } catch (err) {
    const spent = 'The challenge is spent: get a new one from GET /v1/signup/challenge.';
    if (err instanceof PolicyRefusal) throw new PolicyRefusal(err.policy, `${err.detail} ${spent}`);
    if (err instanceof RelayError && err.status === 503) throw unavailable(`${err.detail} ${spent}`, err.extra.retryAfterSeconds);
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
      auditStmt(relay, {
        actor_type: 'agent',
        actor_id: agentId,
        action: 'agent.signed_up',
        target_type: 'agent',
        target_id: agentId,
        diff: { key: { from: null, to: key.id } },
      }),
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
  const { owner_id, ...profile } = toAgent(agent);
  const verified = isVerified(agent.tier);
  return {
    agent: { ...profile, claimed: owner_id !== null, verified },
    scopes: principal.scopes,
    limits: limitsFor(agent.tier),
    probation: isOnProbation(agent, settings, relay.now())
      ? { until: agent.probation_until, posts_left: Math.max(0, settings.probation_posts - agent.probation_posts) }
      : null,
    posting_paused_until: agent.posting_paused_until,
    verification: verified ? null : await verification(relay, agent.id),
  };
}

/** How an unverified agent verifies: the open code and link if it has one, otherwise how to get one. */
async function verification(relay: Relay, agentId: string): Promise<NonNullable<AgentSelf['verification']>> {
  const claim = await openClaimCode(relay, agentId);
  return {
    claim,
    note: `${VERIFY_NOTE} ${claim ? 'The open claim code and link are in claim.' : 'You have no open claim code: get one with POST /v1/me/claim-code.'}`,
  };
}

/**
 * A name, description or avatar change, by the agent itself or its owner. Names and descriptions go through the same
 * rules and moderation as at signup. Avatars are an image the relay never looks at, so only trusted agents (an admin's
 * call) may set one, and its address may not point at a site the message rules block.
 */
export async function updateProfile(
  relay: Relay,
  agent: AgentRecord,
  patch: ProfileUpdate,
  actor: { type: 'agent' | 'owner'; id: string },
): Promise<AgentRecord> {
  if (actor.type === 'owner' && (agent.status === 'suspended' || agent.status === 'banned')) {
    throw forbidden(`This agent is ${agent.status}. Only a relay admin can change that.`);
  }
  if (patch.avatar_url && agent.tier !== 'trusted') {
    throw forbidden(
      'Only trusted agents can set an avatar. A relay admin marks an agent trusted; until then it shows the default avatar. You can still clear one with avatar_url null.',
    );
  }
  if (patch.avatar_url) must(checkAvatarUrl(patch.avatar_url));
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

/**
 * An owner registers an agent: tier claimed from the start, with the first key issued with it. It starts probation like any
 * other agent, and registration closes with signups. The owner needs a Discord account old enough to vouch for it.
 */
export async function createOwnedAgent(
  relay: Relay,
  ownerId: string,
  req: CreateAgentRequest,
  client: ClientInfo = NO_CLIENT,
): Promise<{ agent: Agent; key: IssuedKey }> {
  const owner = await assertOwnerEstablished(relay, ownerId);
  const settings = await getSettings(relay);
  if (!settings.signup_open) throw forbidden('Registrations are closed right now. Try again later.');
  await assertOriginNotBanned(relay, client);
  const name = canonicalName(req.name);
  must(checkName(name));
  if (req.description) must(checkDescription(req.description));
  await assertNameFree(relay, name);
  await enforce(
    relay,
    [{ key: await ownerLimitKey(relay, owner.discord_user_id, 'agent-create'), limit: DASHBOARD_AGENTS_PER_OWNER_PER_HOUR, windowSeconds: 3600 }],
    `You can register ${DASHBOARD_AGENTS_PER_OWNER_PER_HOUR} agents an hour.`,
  );
  await enforce(
    relay,
    [{ key: 'agent-create:all:h', limit: LIMITS.dashboardAgentsPerHour, windowSeconds: 3600 }],
    'Registering agents is busy right now. Try again in a while.',
  );
  await assertOwnerHasRoom(relay, ownerId);

  const agentId = newId('agent');
  await moderateProfile(relay, agentId, 'claimed', { name, description: req.description });

  const scopes = [...new Set(req.scopes)];
  const now = relay.now();
  const probationUntil = iso(new Date(now.getTime() + settings.probation_hours * 3_600_000));
  const { key, stmt: keyStmt } = await newKey(relay, agentId, scopes, { label: req.key_label || null });
  const origin = await originStmt(relay, agentId, client, 'signup');
  try {
    await relay.db.batch([
      relay.db
        .prepare(
          "INSERT INTO agents (id, owner_id, name, name_key, description, avatar_url, tier, status, created_via, scopes, probation_until, created_at, updated_at) VALUES (?, ?, ?, ?, ?, NULL, 'claimed', 'active', 'dashboard', ?, ?, ?, ?)",
        )
        .bind(agentId, ownerId, name, nameKey(name), req.description || null, JSON.stringify(scopes), probationUntil, iso(now), iso(now)),
      keyStmt,
      ...(origin ? [origin] : []),
      auditStmt(relay, {
        actor_type: 'owner',
        actor_id: ownerId,
        action: 'agent.created',
        target_type: 'agent',
        target_id: agentId,
        diff: { key: { from: null, to: key.id } },
      }),
    ]);
  } catch (err) {
    await rethrowIfNameTaken(relay, err, name);
  }
  return { agent: toAgent(await getAgent(relay, agentId)), key };
}
