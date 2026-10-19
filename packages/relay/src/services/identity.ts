import type { AdminAgent, AdminAgentsPage, Agent, AgentStatus, AgentStatusAction, AgentTier, ApiKey, IssuedKey, Owner, Scope } from '@logitland/contracts';
import { LIMITS, newId } from '@logitland/contracts';
import { iso, type Relay, type Stmt } from '../context';
import { hmac, randomToken, sha256 } from '../crypto';
import { conflict, forbidden, invalid, notFound, unauthorized } from '../errors';
import type { AgentPrincipal, AgentRecord, ClientInfo } from '../types';
import type { AuditInput } from './audit';
import { auditStmt } from './audit';
import { enforce, hit, peek } from './limits';
import { banOriginStmts, clientHashes, liftOriginBanStmt, recordOrigin } from './origins';
import { nameKey } from './names';

// Agents, owners and keys. The functions marked as seams are called by other parts; keep their signatures.
// Signup, profiles and claims live in signup.ts and claims.ts.

export interface AgentRow {
  id: string;
  owner_id: string | null;
  name: string;
  name_key: string;
  description: string | null;
  avatar_url: string | null;
  tier: Agent['tier'];
  status: Agent['status'];
  created_via: Agent['created_via'];
  scopes: string;
  owner_hint: string | null;
  probation_until: string | null;
  probation_posts: number;
  posting_paused_until: string | null;
  status_reason: string | null;
  deleted_at: string | null;
  created_at: string;
  updated_at: string;
}

export function toAgentRecord(r: AgentRow): AgentRecord {
  const { name_key: _key, scopes, ...rest } = r;
  return { ...rest, id: r.id as Agent['id'], owner_id: r.owner_id as Agent['owner_id'], scopes: JSON.parse(scopes) as Scope[] };
}

/** The agent as callers outside the relay see it. */
export function toAgent(r: AgentRecord): Agent {
  return {
    id: r.id,
    owner_id: r.owner_id,
    name: r.name,
    description: r.description,
    avatar_url: r.avatar_url,
    tier: r.tier,
    status: r.status,
    created_via: r.created_via,
    scopes: r.scopes,
    created_at: r.created_at,
    updated_at: r.updated_at,
  };
}

export async function getAgent(relay: Relay, id: string): Promise<AgentRecord> {
  const row = await relay.db.prepare('SELECT * FROM agents WHERE id = ?').bind(id).first<AgentRow>();
  if (!row) throw notFound('No such agent');
  return toAgentRecord(row);
}

/** An owner's own agent. Someone else's agent looks exactly like a missing one. */
export async function ownedAgent(relay: Relay, ownerId: string, agentId: string): Promise<AgentRecord> {
  const row = await relay.db.prepare('SELECT * FROM agents WHERE id = ? AND owner_id = ?').bind(agentId, ownerId).first<AgentRow>();
  if (!row) throw notFound('No such agent');
  return toAgentRecord(row);
}

export async function listOwnerAgents(relay: Relay, ownerId: string): Promise<AgentRecord[]> {
  const { results } = await relay.db.prepare('SELECT * FROM agents WHERE owner_id = ? ORDER BY created_at, id').bind(ownerId).all<AgentRow>();
  return results.map(toAgentRecord);
}

/** Called after Discord OAuth. Ownership binds to the Discord user ID; the username is presentation. */
export async function upsertOwner(relay: Relay, discordUserId: string, username: string): Promise<Owner> {
  await relay.db
    .prepare(
      'INSERT INTO owners (id, discord_user_id, username, created_at) VALUES (?, ?, ?, ?) ON CONFLICT (discord_user_id) DO UPDATE SET username = excluded.username',
    )
    .bind(newId('owner'), discordUserId, username, iso(relay.now()))
    .run();
  return (await relay.db.prepare('SELECT * FROM owners WHERE discord_user_id = ?').bind(discordUserId).first<Owner>())!;
}

export async function getOwner(relay: Relay, ownerId: string): Promise<Owner> {
  const owner = await relay.db.prepare('SELECT * FROM owners WHERE id = ?').bind(ownerId).first<Owner>();
  if (!owner) throw notFound('No such owner');
  return owner;
}

export function isAdmin(relay: Relay, owner: Owner): boolean {
  return relay.config.adminDiscordIds.includes(owner.discord_user_id);
}

const DAY_MS = 86_400_000;
/** The first second of 2015: Discord snowflakes count milliseconds from here (docs.discord.com, "Snowflakes"). */
const DISCORD_EPOCH = 1_420_070_400_000n;

/** When a Discord account was created: the timestamp in the top 42 bits of its ID. */
export const discordAccountCreated = (discordUserId: string): Date => new Date(Number((BigInt(discordUserId) >> 22n) + DISCORD_EPOCH));

/**
 * Claiming an agent and registering one from the dashboard need an owner with some history: a Discord account at least
 * ownerMinAccountAgeDays old. Throwaway accounts are the cheap way round probation and the signup limits.
 */
export async function assertOwnerEstablished(relay: Relay, ownerId: string): Promise<Owner> {
  const owner = await getOwner(relay, ownerId);
  const oldEnough = new Date(discordAccountCreated(owner.discord_user_id).getTime() + LIMITS.ownerMinAccountAgeDays * DAY_MS);
  if (oldEnough.getTime() > relay.now().getTime()) {
    throw forbidden(
      `Claiming an agent or registering one needs a Discord account at least ${LIMITS.ownerMinAccountAgeDays} days old. Yours will be old enough on ${iso(oldEnough).slice(0, 10)}.`,
    );
  }
  return owner;
}

/**
 * A rate-limit key for something an owner does. It follows the Discord account rather than the owner row, so deleting the
 * account and signing in again doesn't start a fresh allowance. Hashed: counters hold no Discord IDs.
 */
export async function ownerLimitKey(relay: Relay, discordUserId: string, name: string): Promise<string> {
  return `${name}:${await hmac(relay.config.hashKey, `owner:${discordUserId}`)}`;
}

/** The tier an agent falls back to when nobody vouches for it any more: unverified, unless an admin made it trusted. */
const UNLINKED_TIER = "CASE WHEN tier = 'trusted' THEN tier ELSE 'new' END";

/**
 * Deletes an owner's account. Their agents are unlinked and keep running, but unverified again (tier new, unless an admin made
 * them trusted) since no person stands behind them; claim decisions they made lose their name but stay on record, and the
 * audit trail keeps only the owner ID, which no longer points at anyone.
 */
export async function deleteOwner(relay: Relay, ownerId: string): Promise<void> {
  const owner = await getOwner(relay, ownerId);
  const { results: agents } = await relay.db.prepare('SELECT id, tier FROM agents WHERE owner_id = ?').bind(ownerId).all<{ id: string; tier: AgentTier }>();
  const unverified = agents.filter((a) => a.tier === 'claimed').map((a) => a.id);
  const exists = 'EXISTS (SELECT 1 FROM owners WHERE id = ?)';
  const results = await relay.db.batch([
    auditIf(
      relay,
      {
        actor_type: 'owner',
        actor_id: ownerId,
        action: 'owner.deleted',
        target_type: 'owner',
        target_id: ownerId,
        diff: {
          agents_unlinked: { from: agents.map((a) => a.id), to: null },
          ...(unverified.length ? { agents_unverified: { from: unverified, to: 'new' } } : {}),
        },
      },
      exists,
      ownerId,
    ),
    relay.db
      .prepare(`UPDATE agents SET owner_id = NULL, tier = ${UNLINKED_TIER}, updated_at = ? WHERE owner_id = ? AND ${exists}`)
      .bind(iso(relay.now()), ownerId, ownerId),
    relay.db.prepare(`UPDATE claims SET decided_by = NULL WHERE decided_by = ? AND ${exists}`).bind(ownerId, ownerId),
    relay.db.prepare('DELETE FROM owners WHERE id = ?').bind(ownerId),
  ]);
  if (results[3]!.meta.changes !== 1) throw notFound('No such owner');
  relay.log.info('owner.deleted', { owner_id: owner.id, agents: agents.length });
}

/* ---------- Audit inside a batch ---------- */

/**
 * An audit entry written only if `guard` holds. Put it first in the batch with the same precondition as the change that
 * follows, so a batch that loses a race to another writer (or repeats a change already made) leaves no entry for it.
 */
export function auditIf(relay: Relay, entry: AuditInput, guard: string, ...guardBinds: unknown[]): Stmt {
  return relay.db
    .prepare(
      `INSERT INTO audit_log (id, actor_type, actor_id, action, target_type, target_id, reason, diff, created_at) SELECT ?, ?, ?, ?, ?, ?, ?, ?, ? WHERE ${guard}`,
    )
    .bind(
      newId('audit'),
      entry.actor_type,
      entry.actor_id,
      entry.action,
      entry.target_type,
      entry.target_id,
      entry.reason ?? null,
      entry.diff ? JSON.stringify(entry.diff) : null,
      iso(relay.now()),
      ...guardBinds,
    );
}

/* ---------- Keys ---------- */

interface KeyRow {
  id: string;
  agent_id: string;
  scopes: string;
  label: string | null;
  created_at: string;
  expires_at: string | null;
  revoked_at: string | null;
  last_used_at: string | null;
}

const KEY_COLUMNS = 'id, agent_id, label, scopes, created_at, expires_at, revoked_at, last_used_at';

export const toKey = (r: KeyRow): ApiKey => ({
  id: r.id as ApiKey['id'],
  agent_id: r.agent_id as ApiKey['agent_id'],
  label: r.label,
  scopes: JSON.parse(r.scopes) as Scope[],
  created_at: r.created_at,
  expires_at: r.expires_at,
  revoked_at: r.revoked_at,
  last_used_at: r.last_used_at,
});

/** A fresh key and the statement that stores it, so callers can write it in the same batch as whatever it belongs to. */
export async function newKey(
  relay: Relay,
  agentId: string,
  scopes: Scope[],
  opts: { label?: string | null; expiresInDays?: number; expiresAt?: string | null } = {},
): Promise<{ key: IssuedKey; stmt: Stmt }> {
  const secret = randomToken('lk_');
  const id = newId('key') as IssuedKey['id'];
  const now = relay.now();
  const expires = opts.expiresAt ?? (opts.expiresInDays ? iso(new Date(now.getTime() + opts.expiresInDays * 86_400_000)) : null);
  const key: IssuedKey = {
    id,
    agent_id: agentId as IssuedKey['agent_id'],
    label: opts.label ?? null,
    scopes,
    created_at: iso(now),
    expires_at: expires,
    revoked_at: null,
    last_used_at: null,
    secret,
  };
  const stmt = relay.db
    .prepare('INSERT INTO api_keys (id, agent_id, hash, label, scopes, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .bind(id, agentId, await sha256(secret), key.label, JSON.stringify(scopes), key.created_at, expires);
  return { key, stmt };
}

export async function issueKey(
  relay: Relay,
  agent: AgentRecord,
  request: { label?: string; expires_in_days?: number },
  actor: { type: 'owner' | 'admin'; id: string },
): Promise<IssuedKey> {
  if (agent.status === 'suspended' || agent.status === 'banned') throw forbidden(`This agent is ${agent.status}, so it can’t get new keys.`);
  const { key, stmt } = await newKey(relay, agent.id, agent.scopes, { label: request.label ?? null, expiresInDays: request.expires_in_days });
  await relay.db.batch([
    stmt,
    auditStmt(relay, {
      actor_type: actor.type,
      actor_id: actor.id,
      action: 'key.created',
      target_type: 'key',
      target_id: key.id,
      diff: { agent: { from: null, to: agent.id } },
    }),
  ]);
  return key;
}

export async function listKeys(relay: Relay, agentId: string): Promise<ApiKey[]> {
  const { results } = await relay.db
    .prepare(`SELECT ${KEY_COLUMNS} FROM api_keys WHERE agent_id = ? ORDER BY created_at DESC, id DESC`)
    .bind(agentId)
    .all<KeyRow>();
  return results.map(toKey);
}

export async function revokeKey(relay: Relay, agentId: string, keyId: string, actor: { type: 'owner' | 'admin'; id: string }): Promise<void> {
  const [, revoked] = await relay.db.batch([
    auditIf(
      relay,
      { actor_type: actor.type, actor_id: actor.id, action: 'key.revoked', target_type: 'key', target_id: keyId, diff: { agent: { from: agentId, to: null } } },
      'EXISTS (SELECT 1 FROM api_keys WHERE id = ? AND agent_id = ? AND revoked_at IS NULL)',
      keyId,
      agentId,
    ),
    relay.db.prepare('UPDATE api_keys SET revoked_at = ? WHERE id = ? AND agent_id = ? AND revoked_at IS NULL').bind(iso(relay.now()), keyId, agentId),
  ]);
  if (revoked!.meta.changes !== 1) throw notFound('No active key with that ID');
}

const KEY_ROTATIONS_PER_AGENT_PER_HOUR = 5;

/**
 * An agent replaces the key it is calling with: the old one stops working, and the new one (same scopes, label and expiry) is
 * returned once. Works for any agent, claimed or not, so a leaked key never needs an owner to fix.
 */
export async function rotateKey(relay: Relay, principal: AgentPrincipal): Promise<IssuedKey> {
  const { agent, keyId, scopes } = principal;
  await enforce(
    relay,
    [{ key: `rotate:${agent.id}:h`, limit: KEY_ROTATIONS_PER_AGENT_PER_HOUR, windowSeconds: 3600 }],
    `You can replace your key ${KEY_ROTATIONS_PER_AGENT_PER_HOUR} times an hour.`,
  );
  const old = (await relay.db
    .prepare('SELECT label, expires_at FROM api_keys WHERE id = ?')
    .bind(keyId)
    .first<{ label: string | null; expires_at: string | null }>())!;
  const { key, stmt } = await newKey(relay, agent.id, scopes, { label: old.label, expiresAt: old.expires_at });
  const [, revoked] = await relay.db.batch([
    auditIf(
      relay,
      { actor_type: 'agent', actor_id: agent.id, action: 'key.rotated', target_type: 'key', target_id: keyId, diff: { key: { from: keyId, to: key.id } } },
      'EXISTS (SELECT 1 FROM api_keys WHERE id = ? AND revoked_at IS NULL)',
      keyId,
    ),
    relay.db.prepare('UPDATE api_keys SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL').bind(iso(relay.now()), keyId),
    stmt,
  ]);
  if (revoked!.meta.changes !== 1) {
    // Another rotation with the same key got there first; the key made here was never shown to anyone.
    await relay.db.prepare('DELETE FROM api_keys WHERE id = ?').bind(key.id).run();
    throw unauthorized('That key isn’t valid');
  }
  return key;
}

const DELETED_REASON = 'Deleted by its owner';

/**
 * An owner deletes an agent. The row stays as a tombstone so messages, strikes and audit history keep pointing somewhere: it is
 * banned, unlinked, its name, description, avatar and hint are erased, its keys are revoked, its subscriptions stop and the
 * addresses on file are deleted. Only active or off agents can be deleted: a suspended or banned one is for an admin to resolve.
 */
export async function deleteAgent(relay: Relay, ownerId: string, agentId: string): Promise<void> {
  const agent = await ownedAgent(relay, ownerId, agentId);
  if (agent.status !== 'active' && agent.status !== 'off') throw forbidden(`This agent is ${agent.status}. Only a relay admin can change that.`);
  const now = iso(relay.now());
  const guard = `EXISTS (SELECT 1 FROM agents WHERE id = ? AND owner_id = ? AND status IN ('active', 'off') AND deleted_at IS NULL)`;
  const g = [agentId, ownerId];
  const results = await relay.db.batch([
    auditIf(
      relay,
      {
        actor_type: 'owner',
        actor_id: ownerId,
        action: 'agent.deleted',
        target_type: 'agent',
        target_id: agentId,
        diff: { status: { from: agent.status, to: 'banned' }, owner_id: { from: ownerId, to: null } },
      },
      guard,
      ...g,
    ),
    relay.db
      .prepare(`UPDATE subscriptions SET status = 'paused', paused_reason = 'Agent deleted' WHERE agent_id = ? AND status = 'active' AND ${guard}`)
      .bind(agentId, ...g),
    relay.db
      .prepare(
        `UPDATE deliveries SET status = 'dropped', next_attempt_at = NULL WHERE status IN ('pending', 'retrying') AND subscription_id IN (SELECT id FROM subscriptions WHERE agent_id = ?) AND ${guard}`,
      )
      .bind(agentId, ...g),
    relay.db.prepare(`UPDATE api_keys SET revoked_at = ? WHERE agent_id = ? AND revoked_at IS NULL AND ${guard}`).bind(now, agentId, ...g),
    relay.db.prepare(`UPDATE claims SET expires_at = ? WHERE agent_id = ? AND decision IS NULL AND expires_at > ? AND ${guard}`).bind(now, agentId, now, ...g),
    relay.db.prepare(`DELETE FROM agent_origins WHERE agent_id = ? AND ${guard}`).bind(agentId, ...g),
    relay.db
      .prepare(
        `UPDATE agents SET status = 'banned', status_reason = ?, owner_id = NULL, tier = ${UNLINKED_TIER}, name = 'Deleted agent', name_key = '~deleted~' || id, description = NULL, avatar_url = NULL, owner_hint = NULL, deleted_at = ?, updated_at = ? WHERE id = ? AND owner_id = ? AND status IN ('active', 'off') AND deleted_at IS NULL`,
      )
      .bind(DELETED_REASON, now, now, agentId, ownerId),
  ]);
  if (results[results.length - 1]!.meta.changes !== 1) throw conflict('This agent changed while you were acting. Reload it and try again.');
  relay.log.info('agent.deleted', { agent_id: agentId });
}

/* ---------- Authentication (seam) ---------- */

const LAST_USED_REFRESH_MS = 5 * 60_000;

/**
 * Every agent request: hash the presented key, then check the key and the agent are in good standing. Owners are optional.
 * Bookkeeping is throttled so reads stay reads: last_used_at moves at most every 5 minutes, and where the agent connects
 * from is recorded at most once a day per network.
 */
/** `allowStatuses` lets a route accept agents that aren't active, e.g. a suspended agent reading its status or appealing. */
export async function authenticateKey(relay: Relay, secret: string, client: ClientInfo, opts: { allowStatuses?: AgentStatus[] } = {}): Promise<AgentPrincipal> {
  if (!secret.startsWith('lk_')) throw unauthorized('Send your relay key as a Bearer token');
  const row = await relay.db
    .prepare('SELECT * FROM api_keys WHERE hash = ?')
    .bind(await sha256(secret))
    .first<KeyRow>();
  const now = relay.now();
  const nowIso = iso(now);
  if (!row || row.revoked_at || (row.expires_at && row.expires_at <= nowIso)) throw unauthorized('That key isn’t valid');
  const agent = await getAgent(relay, row.agent_id);
  if (agent.status !== 'active' && !opts.allowStatuses?.includes(agent.status)) throw forbidden(`This agent is ${agent.status}`);

  const stale = iso(new Date(now.getTime() - LAST_USED_REFRESH_MS));
  if (!row.last_used_at || row.last_used_at < stale) {
    await relay.db
      .prepare('UPDATE api_keys SET last_used_at = ? WHERE id = ? AND (last_used_at IS NULL OR last_used_at < ?)')
      .bind(nowIso, row.id, stale)
      .run();
  }
  if (client.ip) {
    const { net } = await clientHashes(relay, client);
    const daily = { key: `origin:${agent.id}:${net}:d`, limit: 1, windowSeconds: 86_400 };
    if ((await peek(relay, daily)) === 0 && (await hit(relay, daily)).ok) await recordOrigin(relay, agent.id, client, 'use');
  }

  const keyScopes = JSON.parse(row.scopes) as Scope[];
  return { agent, keyId: row.id, scopes: keyScopes.filter((s) => agent.scopes.includes(s)) };
}

/* ---------- Status changes ---------- */

interface Transition {
  from: AgentStatus[];
  to: AgentStatus;
  action: string;
  actor: { type: 'owner' | 'admin'; id: string };
  reason?: string;
  /** What admins see as the agent's status reason; cleared when null. */
  statusReason: string | null;
  /** Pause its subscriptions and drop deliveries still waiting. */
  stopDeliveries?: boolean;
  revokeKeys?: boolean;
  /** Record where the agent connected from, so the same operator can't just sign up again. */
  banOrigins?: boolean;
  /** Lift that record. */
  liftBan?: boolean;
}

/**
 * Moves an agent between statuses in one batch. Every statement is guarded by the same precondition (the agent is still in
 * one of the `from` statuses), and the status update goes last, so either everything applies or nothing does: pausing
 * subscriptions, dropping deliveries, revoking keys and the audit entry.
 */
async function transition(relay: Relay, agent: AgentRecord, t: Transition): Promise<AgentRecord> {
  const now = iso(relay.now());
  const inFrom = `status IN (${t.from.map(() => '?').join(', ')})`;
  const precondition = `EXISTS (SELECT 1 FROM agents WHERE id = ? AND ${inFrom})`;
  const guard = [agent.id, ...t.from];
  const stmts: Stmt[] = [
    auditIf(
      relay,
      {
        actor_type: t.actor.type,
        actor_id: t.actor.id,
        action: t.action,
        target_type: 'agent',
        target_id: agent.id,
        reason: t.reason,
        diff: { status: { from: agent.status, to: t.to } },
      },
      precondition,
      ...guard,
    ),
  ];
  if (t.stopDeliveries) {
    stmts.push(
      relay.db
        .prepare(`UPDATE subscriptions SET status = 'paused', paused_reason = ? WHERE agent_id = ? AND status = 'active' AND ${precondition}`)
        .bind(`Agent ${t.to === 'off' ? 'turned off' : t.to}`, agent.id, ...guard),
      relay.db
        .prepare(
          `UPDATE deliveries SET status = 'dropped', next_attempt_at = NULL WHERE status IN ('pending', 'retrying') AND subscription_id IN (SELECT id FROM subscriptions WHERE agent_id = ?) AND ${precondition}`,
        )
        .bind(agent.id, ...guard),
    );
  }
  if (t.revokeKeys)
    stmts.push(
      relay.db.prepare(`UPDATE api_keys SET revoked_at = ? WHERE agent_id = ? AND revoked_at IS NULL AND ${precondition}`).bind(now, agent.id, ...guard),
    );
  if (t.banOrigins) stmts.push(...banOriginStmts(relay, agent.id, precondition, ...guard));
  if (t.liftBan) stmts.push(liftOriginBanStmt(relay, agent.id, precondition, ...guard));
  stmts.push(
    relay.db
      .prepare(`UPDATE agents SET status = ?, status_reason = ?, updated_at = ? WHERE id = ? AND ${inFrom}`)
      .bind(t.to, t.statusReason, now, agent.id, ...t.from),
  );
  const results = await relay.db.batch(stmts);
  if (results[results.length - 1]!.meta.changes !== 1) throw conflict('This agent’s status changed while you were acting. Reload it and try again.');
  return getAgent(relay, agent.id);
}

/** The owner's off switch: its keys stop working, subscriptions pause and waiting deliveries are dropped. */
export async function turnOff(relay: Relay, ownerId: string, agentId: string): Promise<AgentRecord> {
  const agent = await ownedAgent(relay, ownerId, agentId);
  if (agent.status === 'off') return agent;
  if (agent.status !== 'active') throw forbidden(`This agent is ${agent.status}. Only a relay admin can change that.`);
  return transition(relay, agent, {
    from: ['active'],
    to: 'off',
    action: 'agent.turned_off',
    actor: { type: 'owner', id: ownerId },
    statusReason: null,
    stopDeliveries: true,
  });
}

/** Only from off. Subscriptions stay paused: the agent resumes them itself. */
export async function turnOn(relay: Relay, ownerId: string, agentId: string): Promise<AgentRecord> {
  const agent = await ownedAgent(relay, ownerId, agentId);
  if (agent.status === 'active') return agent;
  if (agent.status !== 'off') throw forbidden(`This agent is ${agent.status}. Only a relay admin can change that.`);
  return transition(relay, agent, { from: ['off'], to: 'active', action: 'agent.turned_on', actor: { type: 'owner', id: ownerId }, statusReason: null });
}

export async function adminAct(relay: Relay, adminId: string, agentId: string, input: AgentStatusAction): Promise<AgentRecord> {
  const agent = await getAgent(relay, agentId);
  if (agent.deleted_at) throw conflict('The owner deleted this agent, so it can’t be changed.');
  const actor = { type: 'admin' as const, id: adminId };
  const { reason } = input;
  switch (input.action) {
    case 'suspend':
      if (agent.status !== 'active' && agent.status !== 'off')
        throw conflict(agent.status === 'banned' ? 'This agent is banned. Reinstate it first.' : `This agent is already ${agent.status}.`);
      return transition(relay, agent, {
        from: ['active', 'off'],
        to: 'suspended',
        action: 'agent.suspended',
        actor,
        reason,
        statusReason: reason,
        stopDeliveries: true,
      });
    case 'ban':
      if (agent.status === 'banned') throw conflict('This agent is already banned.');
      return transition(relay, agent, {
        from: ['active', 'off', 'suspended'],
        to: 'banned',
        action: 'agent.banned',
        actor,
        reason,
        statusReason: reason,
        stopDeliveries: true,
        revokeKeys: true,
        banOrigins: true,
      });
    case 'reinstate':
      if (agent.status !== 'suspended' && agent.status !== 'banned') throw conflict('Only suspended or banned agents can be reinstated.');
      return transition(relay, agent, {
        from: ['suspended', 'banned'],
        to: 'active',
        action: 'agent.reinstated',
        actor,
        reason,
        statusReason: null,
        liftBan: true,
      });
    case 'set_tier': {
      const tier = input.tier as AgentTier;
      if (agent.tier === tier) return agent;
      // Only trusted agents have an avatar, so losing the tier takes the avatar with it.
      const dropsAvatar = tier !== 'trusted' && agent.avatar_url !== null;
      const [, changed] = await relay.db.batch([
        auditIf(
          relay,
          {
            actor_type: 'admin',
            actor_id: adminId,
            action: 'agent.tier_changed',
            target_type: 'agent',
            target_id: agent.id,
            reason,
            diff: { tier: { from: agent.tier, to: tier }, ...(dropsAvatar ? { avatar_url: { from: agent.avatar_url, to: null } } : {}) },
          },
          'EXISTS (SELECT 1 FROM agents WHERE id = ? AND tier = ?)',
          agent.id,
          agent.tier,
        ),
        relay.db
          .prepare("UPDATE agents SET tier = ?, avatar_url = CASE WHEN ? = 'trusted' THEN avatar_url ELSE NULL END, updated_at = ? WHERE id = ? AND tier = ?")
          .bind(tier, tier, iso(relay.now()), agent.id, agent.tier),
      ]);
      if (changed!.meta.changes !== 1) throw conflict('This agent changed while you were acting. Reload it and try again.');
      return getAgent(relay, agent.id);
    }
  }
}

/* ---------- Admin registry ---------- */

type AdminRow = AgentRow & {
  owner_username: string | null;
  held_7d: number;
  blocked_7d: number;
  active_strikes: number;
  signup_asn: number | null;
  signup_name: string | null;
  signup_country: string | null;
  signup_seen_at: string | null;
};

const likeEscape = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`);
/** D1 refuses a LIKE pattern over 50 bytes (developers.cloudflare.com/d1/platform/limits). */
const LIKE_PATTERN_MAX_BYTES = 50;

export async function listAgentsAdmin(
  relay: Relay,
  f: { status?: AgentStatus; tier?: AgentTier; q?: string; before?: string; limit: number },
): Promise<AdminAgentsPage> {
  const now = relay.now();
  const where: string[] = [];
  const binds: unknown[] = [];
  for (const [sql, value] of [
    ['a.status = ?', f.status],
    ['a.tier = ?', f.tier],
    ['a.id < ?', f.before],
  ] as const) {
    if (value) {
      where.push(sql);
      binds.push(value);
    }
  }
  const q = f.q?.trim();
  if (q) {
    const key = nameKey(q);
    const patterns = [`%${likeEscape(q)}%`, ...(key ? [`%${likeEscape(key)}%`] : [])];
    if (patterns.some((p) => new TextEncoder().encode(p).length > LIKE_PATTERN_MAX_BYTES)) {
      throw invalid('That search is too long. Search for a shorter part of the name.');
    }
    where.push(`(a.id = ? OR a.name LIKE ? ESCAPE '\\' OR ow.username LIKE ? ESCAPE '\\'${key ? " OR a.name_key LIKE ? ESCAPE '\\'" : ''})`);
    binds.push(q, patterns[0]!, patterns[0]!, ...(key ? [patterns[1]!] : []));
  }
  const weekAgo = iso(new Date(now.getTime() - 7 * 86_400_000));
  const { results } = await relay.db
    .prepare(
      `SELECT a.*, ow.username AS owner_username,
        (SELECT COUNT(*) FROM relay_messages m WHERE m.agent_id = a.id AND m.status = 'held' AND m.created_at > ?) AS held_7d,
        (SELECT COUNT(*) FROM relay_messages m WHERE m.agent_id = a.id AND m.status = 'blocked' AND m.created_at > ?) AS blocked_7d,
        (SELECT COUNT(*) FROM strikes s WHERE s.agent_id = a.id AND s.expires_at > ?) AS active_strikes,
        so.asn AS signup_asn, so.as_org AS signup_name, so.country AS signup_country, so.seen_at AS signup_seen_at
       FROM agents a
       LEFT JOIN owners ow ON ow.id = a.owner_id
       LEFT JOIN agent_origins so ON so.id = (SELECT MIN(id) FROM agent_origins WHERE agent_id = a.id AND kind = 'signup')
       ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
       ORDER BY a.id DESC LIMIT ?`,
    )
    .bind(weekAgo, weekAgo, iso(now), ...binds, f.limit + 1)
    .all<AdminRow>();
  const page = results.slice(0, f.limit);
  const agents: AdminAgent[] = page.map((r) => {
    const rec = toAgentRecord(r);
    return {
      ...toAgent(rec),
      owner_hint: rec.owner_hint,
      probation_until: rec.probation_until,
      probation_posts: rec.probation_posts,
      posting_paused_until: rec.posting_paused_until,
      status_reason: rec.status_reason,
      owner_username: r.owner_username,
      held_7d: r.held_7d,
      blocked_7d: r.blocked_7d,
      active_strikes: r.active_strikes,
      signup_network: r.signup_seen_at ? { asn: r.signup_asn, name: r.signup_name, country: r.signup_country, seen_at: r.signup_seen_at } : null,
    };
  });
  return { agents, next_before: results.length > f.limit ? (page[page.length - 1]!.id as AdminAgentsPage['next_before']) : null };
}
