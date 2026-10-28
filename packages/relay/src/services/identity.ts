import type { AdminAgent, AdminAgentsPage, Agent, AgentStatus, AgentStatusAction, Owner, PublicAgent, Scope } from '@logitland/contracts';
import { LIMITS, newId } from '@logitland/contracts';
import { iso, type Relay, type Stmt } from '../context';
import { hmac } from '../crypto';
import { conflict, forbidden, invalid, notFound } from '../errors';
import type { AgentRecord } from '../types';
import type { AuditInput } from './audit';
import { auditStmt } from './audit';
import { releaseAvatar } from './avatars';
import { dropBots, syncBotRoles, syncIdentity } from './bots';
import { assertOwnerNotBarred, banOriginStmts, banOwnerStmt, liftOriginBanStmt } from './origins';
import { nameKey } from './names';
import { setPersonRole, syncParentRole } from './people-roles';
import { revokeAdoptionXp } from './xp/award';

// Agents and owners: the records, owners' and admins' changes to an agent's status, and revoking a registration.
// Registration and tokens live in tokens.ts, profiles in signup.ts, adoption in claims.ts and adoption.ts.

export interface AgentRow {
  id: string;
  kind: AgentRecord['kind'];
  owner_id: string | null;
  adopted_at: string | null;
  name: string;
  name_key: string;
  name_changed_at: string | null;
  avatar_url: string | null;
  level: number;
  xp: number;
  status: AgentStatus;
  scopes: string;
  claim_token_hash: string | null;
  claim_token_expires: string | null;
  daily_event_cap: number | null;
  posting_paused_until: string | null;
  status_reason: string | null;
  deleted_at: string | null;
  created_at: string;
  updated_at: string;
}

export function toAgentRecord(r: AgentRow): AgentRecord {
  const { name_key: _key, claim_token_hash: _hash, claim_token_expires: _expires, scopes, ...rest } = r;
  return { ...rest, scopes: JSON.parse(scopes) as Scope[] };
}

/** The address of an agent's sigil: a PNG the relay renders from its ID, so it never changes (#20, #30 Q10). */
export const sigilUrl = (relay: Relay, agentId: string) => `${relay.config.publicUrl}/v1/avatars/${agentId}.png`;

/** The agent as callers outside the relay see it. `avatar_url` is what Discord shows: the custom avatar, else the sigil. */
export function toAgent(relay: Relay, r: AgentRecord): Agent {
  return {
    id: r.id as Agent['id'],
    owner_id: r.owner_id as Agent['owner_id'],
    adopted_at: r.adopted_at,
    name: r.name,
    avatar_url: r.avatar_url ?? sigilUrl(relay, r.id),
    custom_avatar: r.avatar_url !== null,
    level: r.level,
    xp: r.xp,
    status: r.status,
    scopes: r.scopes,
    created_at: r.created_at,
    updated_at: r.updated_at,
  };
}

export const toPublicAgent = (relay: Relay, r: AgentRecord): PublicAgent => {
  const { id, name, avatar_url, level, created_at } = toAgent(relay, r);
  return { id, name, avatar_url, level, created_at };
};

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
  const { results } = await relay.db.prepare('SELECT * FROM agents WHERE owner_id = ? ORDER BY adopted_at, id').bind(ownerId).all<AgentRow>();
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

const DAY_MS = 86_400_000;
/** The first second of 2015: Discord snowflakes count milliseconds from here (docs.discord.com, "Snowflakes"). */
const DISCORD_EPOCH = 1_420_070_400_000n;

/** When a Discord account was created: the timestamp in the top 42 bits of its ID. */
export const discordAccountCreated = (discordUserId: string): Date => new Date(Number((BigInt(discordUserId) >> 22n) + DISCORD_EPOCH));

/** Adopting needs an owner with some history: a Discord account at least ownerMinAccountAgeDays old. Throwaway accounts are the cheap way round the limits. */
export async function assertOwnerEstablished(relay: Relay, ownerId: string): Promise<Owner> {
  const owner = await getOwner(relay, ownerId);
  const oldEnough = new Date(discordAccountCreated(owner.discord_user_id).getTime() + LIMITS.ownerMinAccountAgeDays * DAY_MS);
  if (oldEnough.getTime() > relay.now().getTime()) {
    throw forbidden(
      `Adopting an agent needs a Discord account at least ${LIMITS.ownerMinAccountAgeDays} days old. Yours will be old enough on ${iso(oldEnough).slice(0, 10)}.`,
    );
  }
  await assertOwnerNotBarred(relay, owner.discord_user_id);
  return owner;
}

/** One Discord account vouches for this many agents at most. */
const MAX_AGENTS_PER_OWNER = 10;

export async function assertOwnerHasRoom(relay: Relay, ownerId: string): Promise<void> {
  const row = await relay.db
    .prepare("SELECT COUNT(*) AS n FROM agents WHERE owner_id = ? AND status IN ('active', 'off', 'suspended')")
    .bind(ownerId)
    .first<{ n: number }>();
  if ((row?.n ?? 0) >= MAX_AGENTS_PER_OWNER) {
    throw forbidden(`One Discord account can own ${MAX_AGENTS_PER_OWNER} agents. Revoke one you no longer use first.`);
  }
}

/**
 * A rate-limit key for something an owner does. It follows the Discord account rather than the owner row, so deleting the
 * account and signing in again doesn't start a fresh allowance. Hashed: counters hold no Discord IDs.
 */
export async function ownerLimitKey(relay: Relay, discordUserId: string, name: string): Promise<string> {
  return `${name}:${await hmac(relay.config.hashKey, `owner:${discordUserId}`)}`;
}

/**
 * Deletes an owner's account. Their agents become orphans and keep running (one that was off is turned on, since nobody is
 * left to), losing the XP adoption gave them and any level it brought; adoption decisions they made lose their name but stay on record, and the audit trail
 * keeps only the owner ID, which no longer points at anyone. Their Logan sign-ins and requests go with them.
 */
export async function deleteOwner(relay: Relay, ownerId: string): Promise<void> {
  const owner = await getOwner(relay, ownerId);
  const { results: agents } = await relay.db
    .prepare('SELECT id, status FROM agents WHERE owner_id = ?')
    .bind(ownerId)
    .all<{ id: string; status: AgentStatus }>();
  const wasOff = agents.filter((a) => a.status === 'off').map((a) => a.id);
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
          agents_orphaned: { from: agents.map((a) => a.id), to: null },
          ...(wasOff.length ? { agents_turned_on: { from: wasOff, to: 'active' } } : {}),
        },
      },
      exists,
      ownerId,
    ),
    relay.db
      .prepare(
        `UPDATE agents SET owner_id = NULL, adopted_at = NULL, status = CASE WHEN status = 'off' THEN 'active' ELSE status END, updated_at = ? WHERE owner_id = ? AND ${exists}`,
      )
      .bind(iso(relay.now()), ownerId, ownerId),
    relay.db.prepare(`UPDATE claims SET decided_by = NULL WHERE decided_by = ? AND ${exists}`).bind(ownerId, ownerId),
    ...['adoption_tokens', 'logan_codes', 'logan_tokens', 'logan_requests'].map((table) =>
      relay.db.prepare(`DELETE FROM ${table} WHERE owner_id = ? AND ${exists}`).bind(ownerId, ownerId),
    ),
    relay.db.prepare('DELETE FROM owners WHERE id = ?').bind(ownerId),
  ]);
  if (results.at(-1)!.meta.changes === 0) throw notFound('No such owner');
  relay.log.info('owner.deleted', { owner_id: owner.id, agents: agents.length });
  await revokeAdoptionXp(
    relay,
    agents.map((a) => a.id),
  );
  await dropBots(
    relay,
    agents.map((a) => a.id),
    'owner_deleted',
  );
  if (agents.length) await setPersonRole(relay, owner.discord_user_id, 'parents_role_id', false);
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

/** Statements that stop an agent's deliveries now: the webhook POSTs still waiting are dropped. */
function stopDeliveryStmts(relay: Relay, agentId: string, guard: string, ...g: unknown[]): Stmt[] {
  return [
    relay.db
      .prepare(`UPDATE deliveries SET status = 'dropped', next_attempt_at = NULL WHERE agent_id = ? AND status IN ('pending', 'retrying') AND ${guard}`)
      .bind(agentId, ...g),
  ];
}

const REVOKED_NAME = 'Revoked agent';

/**
 * Revokes a registration (#7), by its owner or an admin. The row stays as a tombstone so messages, strikes and audit history keep
 * pointing somewhere: it is banned and unlinked, its name and avatar are erased, its tokens stop, its subscriptions end and the
 * addresses on file are deleted. Its identity assertion no longer exchanges, so the agent would have to register again. With
 * strikes running, the networks it used stay closed to new signups: revoking is no way out of a sanction.
 */
export async function revokeRegistration(relay: Relay, agent: AgentRecord, actor: { type: 'owner' | 'admin'; id: string }, reason?: string): Promise<void> {
  if (agent.deleted_at) return;
  // An owner can't erase an agent an admin suspended or banned, nor the origin record that goes with it.
  if (actor.type === 'owner' && (agent.status === 'suspended' || agent.status === 'banned'))
    throw forbidden(`This agent is ${agent.status}. Only a relay admin can change that.`);
  const now = iso(relay.now());
  const guard = 'EXISTS (SELECT 1 FROM agents WHERE id = ? AND deleted_at IS NULL)';
  const g = [agent.id];
  const results = await relay.db.batch([
    auditIf(
      relay,
      {
        actor_type: actor.type,
        actor_id: actor.id,
        action: 'agent.revoked',
        target_type: 'agent',
        target_id: agent.id,
        reason: reason ?? null,
        diff: { status: { from: agent.status, to: 'banned' }, owner_id: { from: agent.owner_id, to: null } },
      },
      guard,
      ...g,
    ),
    ...stopDeliveryStmts(relay, agent.id, guard, ...g),
    relay.db.prepare(`DELETE FROM subscriptions WHERE agent_id = ? AND ${guard}`).bind(agent.id, ...g),
    relay.db.prepare(`DELETE FROM agent_webhooks WHERE agent_id = ? AND ${guard}`).bind(agent.id, ...g),
    relay.db.prepare(`UPDATE access_tokens SET revoked_at = ? WHERE agent_id = ? AND revoked_at IS NULL AND ${guard}`).bind(now, agent.id, ...g),
    relay.db.prepare(`UPDATE claims SET expires_at = ? WHERE agent_id = ? AND decision IS NULL AND expires_at > ? AND ${guard}`).bind(now, agent.id, now, ...g),
    ...banOriginStmts(relay, agent.id, `${guard} AND EXISTS (SELECT 1 FROM strikes WHERE agent_id = ? AND expires_at > ?)`, ...g, agent.id, now),
    relay.db.prepare(`DELETE FROM agent_origins WHERE agent_id = ? AND ${guard}`).bind(agent.id, ...g),
    relay.db.prepare(`UPDATE conversation SET display_name = '${REVOKED_NAME}' WHERE agent_id = ? AND ${guard}`).bind(agent.id, ...g),
    relay.db
      .prepare(
        `UPDATE events SET payload = json_set(payload, '$.data.author.display_name', '${REVOKED_NAME}') WHERE message_id IN (SELECT message_id FROM conversation WHERE agent_id = ?) AND json_extract(payload, '$.data.author.agent_id') = ? AND ${guard}`,
      )
      .bind(agent.id, agent.id, ...g),
    relay.db
      .prepare(
        `UPDATE agents SET status = 'banned', status_reason = ?, owner_id = NULL, adopted_at = NULL, name = '${REVOKED_NAME}', name_key = '~revoked~' || id, avatar_url = NULL, claim_token_hash = NULL, deleted_at = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL`,
      )
      .bind(actor.type === 'owner' ? 'Revoked by its owner' : 'Revoked by an admin', now, now, agent.id),
  ]);
  if (results[results.length - 1]!.meta.changes === 0) throw conflict('This agent changed while you were acting. Reload it and try again.');
  relay.log.info('agent.revoked', { agent_id: agent.id, by: actor.type });
  await releaseAvatar(relay, agent.avatar_url);
  await dropBots(relay, [agent.id], 'revoked');
  if (agent.owner_id) await syncParentRole(relay, agent.owner_id);
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
  /** Drop deliveries still waiting. Subscriptions stay, and deliver again when the agent is back. */
  stopDeliveries?: boolean;
  revokeTokens?: boolean;
  /** Record where the agent connected from, so the same operator can't just sign up again. */
  banOrigins?: boolean;
  /** Lift that record. */
  liftBan?: boolean;
}

/**
 * Moves an agent between statuses in one batch. Every statement is guarded by the same precondition (the agent is still in
 * one of the `from` statuses), and the status update goes last, so either everything applies or nothing does.
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
  if (t.stopDeliveries) stmts.push(...stopDeliveryStmts(relay, agent.id, precondition, ...guard));
  if (t.revokeTokens)
    stmts.push(
      relay.db.prepare(`UPDATE access_tokens SET revoked_at = ? WHERE agent_id = ? AND revoked_at IS NULL AND ${precondition}`).bind(now, agent.id, ...guard),
    );
  if (t.banOrigins) {
    stmts.push(...banOriginStmts(relay, agent.id, precondition, ...guard));
    if (agent.owner_id) {
      const owner = await relay.db.prepare('SELECT discord_user_id FROM owners WHERE id = ?').bind(agent.owner_id).first<{ discord_user_id: string }>();
      if (owner) stmts.push(await banOwnerStmt(relay, agent.id, owner.discord_user_id, precondition, ...guard));
    }
  }
  if (t.liftBan) stmts.push(liftOriginBanStmt(relay, agent.id, precondition, ...guard));
  stmts.push(
    relay.db
      .prepare(`UPDATE agents SET status = ?, status_reason = ?, updated_at = ? WHERE id = ? AND ${inFrom}`)
      .bind(t.to, t.statusReason, now, agent.id, ...t.from),
  );
  const results = await relay.db.batch(stmts);
  if (results[results.length - 1]!.meta.changes === 0) throw conflict('This agent’s status changed while you were acting. Reload it and try again.');
  return getAgent(relay, agent.id);
}

/** The owner's off switch: its tokens stop working and waiting deliveries are dropped. */
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
    revokeTokens: true,
  });
}

/** Only from off. The agent exchanges its assertion for a new token to come back. */
export async function turnOn(relay: Relay, ownerId: string, agentId: string): Promise<AgentRecord> {
  const agent = await ownedAgent(relay, ownerId, agentId);
  if (agent.status === 'active') return agent;
  if (agent.status !== 'off') throw forbidden(`This agent is ${agent.status}. Only a relay admin can change that.`);
  return transition(relay, agent, { from: ['off'], to: 'active', action: 'agent.turned_on', actor: { type: 'owner', id: ownerId }, statusReason: null });
}

/** Every admin action on an agent but `rename`, which goes through `updateProfile`. */
export async function adminAct(
  relay: Relay,
  adminId: string,
  agentId: string,
  input: AgentStatusAction & { action: Exclude<AgentStatusAction['action'], 'rename'> },
): Promise<AgentRecord> {
  const agent = await getAgent(relay, agentId);
  if (agent.deleted_at) throw conflict('This agent’s registration was revoked, so it can’t be changed.');
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
        revokeTokens: true,
        banOrigins: true,
      });
    case 'reinstate':
      if (agent.status !== 'suspended' && agent.status !== 'banned') throw conflict('Only suspended or banned agents can be reinstated.');
      // A reinstated agent exchanges the assertion it kept for new tokens; nothing needs handing over.
      return transition(relay, agent, {
        from: ['suspended', 'banned'],
        to: 'active',
        action: 'agent.reinstated',
        actor,
        reason,
        statusReason: null,
        liftBan: true,
      });
    case 'revoke':
      await revokeRegistration(relay, agent, actor, reason);
      return getAgent(relay, agent.id);
    case 'set_level': {
      const level = input.level!;
      if (agent.level === level) return agent;
      const [, changed] = await relay.db.batch([
        auditIf(
          relay,
          {
            actor_type: 'admin',
            actor_id: adminId,
            action: 'agent.level_set',
            target_type: 'agent',
            target_id: agent.id,
            reason,
            diff: { level: { from: agent.level, to: level } },
          },
          'EXISTS (SELECT 1 FROM agents WHERE id = ? AND level = ?)',
          agent.id,
          agent.level,
        ),
        relay.db.prepare('UPDATE agents SET level = ?, updated_at = ? WHERE id = ? AND level = ?').bind(level, iso(relay.now()), agent.id, agent.level),
      ]);
      if (changed!.meta.changes === 0) throw conflict('This agent changed while you were acting. Reload it and try again.');
      await syncBotRoles(relay, agent.id);
      return getAgent(relay, agent.id);
    }
    case 'reset_avatar': {
      if (agent.avatar_url === null) return agent;
      await relay.db.batch([
        auditStmt(relay, {
          actor_type: 'admin',
          actor_id: adminId,
          action: 'agent.avatar_reset',
          target_type: 'agent',
          target_id: agent.id,
          reason,
          diff: { avatar_url: { from: agent.avatar_url, to: null } },
        }),
        relay.db.prepare('UPDATE agents SET avatar_url = NULL, updated_at = ? WHERE id = ?').bind(iso(relay.now()), agent.id),
      ]);
      await releaseAvatar(relay, agent.avatar_url);
      await syncIdentity(relay, agent.id);
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
  f: { status?: AgentStatus; level?: number; q?: string; before?: string; limit: number },
): Promise<AdminAgentsPage> {
  const now = relay.now();
  const where: string[] = [];
  const binds: unknown[] = [];
  for (const [sql, value] of [
    ['a.status = ?', f.status],
    ['a.level = ?', f.level],
    ['a.id < ?', f.before],
  ] as const) {
    if (value !== undefined) {
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
      ...toAgent(relay, rec),
      kind: rec.kind,
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
