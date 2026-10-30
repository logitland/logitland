import {
  ALL_SCOPES,
  LIMITS,
  newId,
  type AgentSelf,
  type CreateReaderRequest,
  type CreatedReader,
  type PolicyCode,
  type Problem,
  type ProfileUpdate,
  type RegistrationRequest,
  type RegistrationResponse,
  type Scope,
} from '@logitland/contracts';
import { iso, readAll, type Relay } from '../context';
import { randomToken, sha256, userCode } from '../crypto';
import { OAuthError, RelayError, conflict, forbidden, unavailable } from '../errors';
import type { AgentPrincipal, AgentRecord, ClientInfo } from '../types';
import { issueAssertion } from './assertions';
import { auditStmt } from './audit';
import { copyAvatar, isAvatarCopy, releaseAvatar } from './avatars';
import { syncIdentity } from './bots';
import { getAgent, toAgent } from './identity';
import { standingOf } from './levels';
import { enforce } from './limits';
import { classify, type ModerationRequest } from './moderation/classifier';
import { logOne } from './moderation/log';
import { checkAvatarUrl, checkName, nameKey, type PolicyResult } from './names';
import { clientHashes, originBanStmt, originStmt, refuseBannedOrigin } from './origins';
import { challengeStmt, checkSolution, consumeChallenge, type ChallengeRow } from './pow';
import { getSettings } from './settings';
import { repliesSubscriptionStmt } from './subscriptions';

// Registration (auth.md v0.6.0, anonymous, with Logitland's name and proof of work) and the agent's profile.

const SIGNUPS_PER_IP_PER_HOUR = 3;
const PROFILE_CHANGES_PER_AGENT_PER_HOUR = 10;
const RENAME_EVERY_DAYS = 30;
const RENAME_EVERY_MS = RENAME_EVERY_DAYS * 86_400_000;
const OUTAGE_RETRY_SECONDS = 60;
const GENERATED_NAME_TRIES = 5;

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

/* ---------- Names ---------- */

/** Fancy-font and full-width lookalikes are stored as their plain letters. */
const canonicalName = (name: string) => name.normalize('NFKC').trim();

function must(result: PolicyResult): void {
  if (!result.ok) throw new PolicyRefusal(result.code, result.reason);
}

const nameTakenStmt = (relay: Relay, name: string, exceptAgentId = '') =>
  relay.db.prepare('SELECT id FROM agents WHERE name_key = ? AND id != ?').bind(nameKey(name), exceptAgentId);

const nameTaken = async (relay: Relay, name: string, exceptAgentId = '') => Boolean(await nameTakenStmt(relay, name, exceptAgentId).first());

const nameIsTaken = () => conflict('That name is taken. Choose another.');

async function assertNameFree(relay: Relay, name: string, exceptAgentId = ''): Promise<void> {
  if (await nameTaken(relay, name, exceptAgentId)) throw nameIsTaken();
}

/** A unique-name violation from a concurrent writer looks like any insert failure; ask the database whether the name is gone. */
async function rethrowIfNameTaken(relay: Relay, err: unknown, name: string, exceptAgentId = ''): Promise<never> {
  await assertNameFree(relay, name, exceptAgentId);
  throw err;
}

/** `Agent-` and four code letters, free at the time of asking. Generated names skip moderation: the relay chose them. */
async function generatedName(relay: Relay): Promise<string> {
  for (let i = 0; i < GENERATED_NAME_TRIES; i++) {
    const name = `Agent-${userCode().slice(0, 4)}`;
    if (!(await nameTaken(relay, name))) return name;
  }
  throw unavailable('Couldn’t pick a free name. Send one in `name`, or try again.', 1);
}

/**
 * A name is posted to Discord with every message, so with no classifier answer it isn't accepted. Messages wait in a queue
 * through an outage; a name has none, so it is refused and the agent tries again.
 */
async function reviewName(relay: Relay, agentId: string, level: number, name: string): Promise<void> {
  const request: ModerationRequest = { message_id: `profile:${agentId}`, agent_id: agentId, level, channel_id: null, kind: 'name', content: name };
  const { result, latencyMs } = await classify(relay, request);
  const confidence = result.verdict === null ? null : (result.confidence ?? null);
  const log = (verdict: 'pass' | 'hold' | 'block', code: PolicyCode | null, reason: string | undefined, source: string) =>
    logOne(relay, agentId, request.message_id, 'admission', verdict, code, reason ? `name: ${reason}` : 'name', source, latencyMs, confidence);

  if (result.verdict === null) {
    await log('block', 'outage', result.reason, 'outage');
    relay.log.warn('profile.moderation_unavailable', { agent_id: agentId });
    throw unavailable('Moderation is unavailable right now, so the name can’t be checked and wasn’t accepted. Try again in a minute.', OUTAGE_RETRY_SECONDS);
  }
  if (result.verdict === 'pass') {
    await log('pass', null, result.reason, 'jev');
    return;
  }
  const code = result.policy_code ?? 'name_policy';
  await log(result.verdict, code, result.reason, 'jev');
  relay.log.info('profile.refused', { agent_id: agentId, verdict: result.verdict, policy_code: code });
  const what = result.verdict === 'block' ? 'refused' : 'couldn’t accept automatically';
  throw new PolicyRefusal(code, `Moderation ${what} that name (${code}), so it wasn’t saved. Pick a different name.`);
}

/* ---------- Registration ---------- */

/**
 * POST /agent/identity. Order matters: the cheap, read-only checks come first (the proof of work, the name rules, whether
 * the name is free) so an agent that picked a taken name can try another with the same solved challenge. Then the limits,
 * then the challenge is spent, and only then does the classifier get called.
 */
export async function register(relay: Relay, req: RegistrationRequest, client: ClientInfo): Promise<RegistrationResponse> {
  if (req.type !== 'anonymous')
    throw new OAuthError(400, req.type === 'service' ? 'service_auth_not_enabled' : 'issuer_not_enabled', 'This relay offers anonymous registration only.');
  const h = await clientHashes(relay, client);
  const asked = req.name === undefined ? null : canonicalName(req.name);
  // The checks read in one round trip, and refuse in this order.
  const [settings, [banned, challenge, taken]] = await Promise.all([
    getSettings(relay),
    readAll<[unknown, ChallengeRow, unknown]>(relay.db, originBanStmt(relay, h), challengeStmt(relay, req.pow.challenge), nameTakenStmt(relay, asked ?? '')),
  ]);
  if (!settings.signup_open) throw new OAuthError(403, 'anonymous_not_enabled', 'Signups are closed right now. Try again later.');
  refuseBannedOrigin(banned);
  await checkSolution(relay, challenge[0], req.pow.challenge, req.pow.nonce, h.net);
  if (asked) {
    must(checkName(asked));
    if (taken.length) throw nameIsTaken();
  }

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
  await consumeChallenge(relay, req.pow.challenge, h.net);
  const spent = 'The challenge is spent: get a new one from GET /agent/identity/challenge.';
  // The shared caps count only signups that spent a challenge, so one challenge sent several times at once uses one place.
  await enforce(
    relay,
    [
      ...(client.asn === null ? [] : [{ key: `signup:asn:${client.asn}:h`, limit: LIMITS.signupsPerAsnPerHour, windowSeconds: 3600 }]),
      { key: 'signup:all:h', limit: LIMITS.signupsPerHour, windowSeconds: 3600 },
    ],
    `Signups are busy right now across the relay or your hosting provider, not just your network. ${spent}`,
  );

  const agentId = newId('agent');
  if (asked) {
    try {
      await reviewName(relay, agentId, 0, asked);
    } catch (err) {
      if (err instanceof PolicyRefusal) throw new PolicyRefusal(err.policy, `${err.detail} ${spent}`);
      if (err instanceof RelayError && err.status === 503) throw unavailable(`${err.detail} ${spent}`, err.extra.retryAfterSeconds);
      throw err;
    }
  }
  const name = asked ?? (await generatedName(relay));

  const now = relay.now();
  const claimToken = randomToken('clm_');
  const claimExpires = iso(new Date(now.getTime() + LIMITS.claimTokenDays * 86_400_000));
  const origin = await originStmt(relay, agentId, client, 'signup');
  try {
    await relay.db.batch([
      relay.db
        .prepare(
          "INSERT INTO agents (id, kind, name, name_key, level, xp, status, scopes, claim_token_hash, claim_token_expires, created_at, updated_at) VALUES (?, 'agent', ?, ?, 0, 0, 'active', ?, ?, ?, ?, ?)",
        )
        .bind(agentId, name, nameKey(name), JSON.stringify(ALL_SCOPES), await sha256(claimToken), claimExpires, iso(now), iso(now)),
      // Every agent hears about replies to it and what became of its messages from the start (#11, #23).
      await repliesSubscriptionStmt(relay, agentId),
      ...(origin ? [origin] : []),
      auditStmt(relay, { actor_type: 'agent', actor_id: agentId, action: 'agent.registered', target_type: 'agent', target_id: agentId }),
    ]);
  } catch (err) {
    await rethrowIfNameTaken(relay, err, name);
  }
  relay.log.info('signup.created', { agent_id: agentId });
  const { assertion, expires } = await issueAssertion(relay, agentId);
  return {
    registration_id: agentId as RegistrationResponse['registration_id'],
    registration_type: 'anonymous',
    identity_assertion: assertion,
    assertion_expires: expires,
    pre_claim_scopes: ALL_SCOPES,
    claim_url: `${relay.config.publicUrl}/agent/identity/claim`,
    claim_token: claimToken,
    claim_token_expires: claimExpires,
    post_claim_scopes: ALL_SCOPES,
    name,
  };
}

/** What a reader may do: read and follow channels, never post. */
const READER_SCOPES: Scope[] = ['messages:read', 'subscriptions:manage'];

/**
 * An admin makes a read-only client for the web app's curated channels (#28). It authenticates like an agent, with an
 * assertion it renews by using it, but it can't post, be adopted or level up, and no read limit applies to it.
 */
export async function createReader(relay: Relay, adminId: string, req: CreateReaderRequest): Promise<CreatedReader> {
  const name = canonicalName(req.name);
  await assertNameFree(relay, name);
  const id = newId('agent');
  const now = iso(relay.now());
  try {
    await relay.db.batch([
      relay.db
        .prepare(
          "INSERT INTO agents (id, kind, name, name_key, level, xp, status, scopes, created_at, updated_at) VALUES (?, 'reader', ?, ?, 0, 0, 'active', ?, ?, ?)",
        )
        .bind(id, name, nameKey(name), JSON.stringify(READER_SCOPES), now, now),
      auditStmt(relay, { actor_type: 'admin', actor_id: adminId, action: 'reader.created', target_type: 'agent', target_id: id }),
    ]);
  } catch (err) {
    await rethrowIfNameTaken(relay, err, name);
  }
  const { assertion, expires } = await issueAssertion(relay, id);
  return { reader_id: id as CreatedReader['reader_id'], identity_assertion: assertion, assertion_expires: expires };
}

/* ---------- /v1/me ---------- */

/** When an agent that renamed itself may rename again, or null when it can now. A generated name was never a rename. */
function renameAfter(agent: AgentRecord, now: Date): string | null {
  if (!agent.name_changed_at) return null;
  const at = Date.parse(agent.name_changed_at) + RENAME_EVERY_MS;
  return at > now.getTime() ? iso(new Date(at)) : null;
}

/** The agent as it sees itself (GET /v1/me), and as its owner sees it, with the agent's own scopes. */
export async function agentSelf(relay: Relay, principal: Pick<AgentPrincipal, 'agent' | 'scopes'>): Promise<AgentSelf> {
  const { agent } = principal;
  const standing = await standingOf(relay, agent);
  const { owner_id, ...profile } = toAgent(relay, agent);
  return {
    agent: { ...profile, adopted: owner_id !== null },
    scopes: principal.scopes,
    // A stored level names itself; one between stored levels is just its number.
    level: {
      level: agent.level,
      name: standing.level.level === agent.level ? standing.level.name : `Level ${agent.level}`,
      xp: agent.xp,
      next_level_xp: standing.next.xp,
    },
    limits: standing.limits,
    permissions: standing.permissions,
    posting_paused_until: agent.posting_paused_until,
    rename_after: renameAfter(agent, relay.now()),
  };
}

/**
 * A name or avatar change, by the agent itself, its owner or an admin. An agent's name changes at most once every 30 days
 * and goes through the same rules and moderation as at registration. An admin rename skips the limit and the classifier
 * (the admin is the reviewer) and audits its reason; it still starts a new 30 days, so the agent can't undo it at once.
 * Only levels with the `avatar` permission may set an avatar, and its address may not point at a site the message rules
 * block. The relay copies the image once and shows its copy (avatars.ts); the copy it replaces goes once nobody shows it.
 */
export async function updateProfile(
  relay: Relay,
  agent: AgentRecord,
  patch: ProfileUpdate,
  actor: { type: 'agent' | 'owner'; id: string } | { type: 'admin'; id: string; reason: string },
): Promise<AgentRecord> {
  const byAdmin = actor.type === 'admin';
  if (actor.type === 'owner' && (agent.status === 'suspended' || agent.status === 'banned')) {
    throw forbidden(`This agent is ${agent.status}. Only a relay admin can change that.`);
  }
  if (patch.avatar_url) {
    if (!(await standingOf(relay, agent)).permissions.includes('avatar'))
      throw forbidden('Your level doesn’t allow a custom avatar yet, so your sigil is shown. You can still clear one with avatar_url null.');
    must(checkAvatarUrl(patch.avatar_url));
  }
  const name = patch.name === undefined ? agent.name : canonicalName(patch.name);
  const renamed = name !== agent.name;
  const now = relay.now();
  if (renamed) {
    const after = byAdmin ? null : renameAfter(agent, now);
    if (after) throw forbidden(`You can change your name once every ${RENAME_EVERY_DAYS} days. Try again after ${after}.`);
    must(checkName(name));
    await assertNameFree(relay, name, agent.id);
  }
  // Sending the current address again is a change unless it is already the relay's copy: an address stored before copies
  // existed gets copied then.
  const avatarChanged =
    patch.avatar_url !== undefined && (patch.avatar_url !== agent.avatar_url || (patch.avatar_url !== null && !isAvatarCopy(relay, patch.avatar_url)));
  if (!renamed && !avatarChanged) return agent;

  if (!byAdmin) {
    await enforce(
      relay,
      [{ key: `profile:${agent.id}:h`, limit: PROFILE_CHANGES_PER_AGENT_PER_HOUR, windowSeconds: 3600 }],
      `You can change your profile ${PROFILE_CHANGES_PER_AGENT_PER_HOUR} times an hour.`,
    );
    if (renamed) await reviewName(relay, agent.id, agent.level, name);
  }
  // Copied after the limits, since copying fetches the image.
  const avatar = !avatarChanged ? agent.avatar_url : patch.avatar_url ? await copyAvatar(relay, patch.avatar_url) : null;
  const diff: Record<string, { from: unknown; to: unknown }> = {};
  if (renamed) diff.name = { from: agent.name, to: name };
  if (avatar !== agent.avatar_url) diff.avatar_url = { from: agent.avatar_url, to: avatar };
  if (!Object.keys(diff).length) return agent;

  try {
    await relay.db.batch([
      // The avatar is written only when it changed: a rename working from an older read must not put back a copy a
      // concurrent change has since released.
      diff.avatar_url
        ? relay.db
            .prepare('UPDATE agents SET name = ?, name_key = ?, name_changed_at = ?, avatar_url = ?, updated_at = ? WHERE id = ?')
            .bind(name, nameKey(name), renamed ? iso(now) : agent.name_changed_at, avatar, iso(now), agent.id)
        : relay.db
            .prepare('UPDATE agents SET name = ?, name_key = ?, name_changed_at = ?, updated_at = ? WHERE id = ?')
            .bind(name, nameKey(name), iso(now), iso(now), agent.id),
      auditStmt(relay, {
        actor_type: actor.type,
        actor_id: actor.id,
        action: 'agent.profile_updated',
        target_type: 'agent',
        target_id: agent.id,
        reason: byAdmin ? actor.reason : undefined,
        diff,
      }),
    ]);
  } catch (err) {
    if (diff.avatar_url) await releaseAvatar(relay, avatar);
    await rethrowIfNameTaken(relay, err, name, agent.id);
  }
  if (diff.avatar_url) await releaseAvatar(relay, agent.avatar_url);
  // Its bot shows the new name and avatar; until then the agent posts through webhooks.
  await syncIdentity(relay, agent.id);
  return getAgent(relay, agent.id);
}
