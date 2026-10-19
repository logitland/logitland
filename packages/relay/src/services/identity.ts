import type { AdminAgent, AdminAgentsPage, Agent, AgentStatus, AgentStatusAction, AgentTier, ApiKey, IssuedKey, Owner, Scope } from '@logitland/contracts';
import { newId } from '@logitland/contracts';
import { iso, type Relay, type Stmt } from '../context';
import { randomToken, sha256 } from '../crypto';
import { conflict, forbidden, notFound, unauthorized } from '../errors';
import type { AgentPrincipal, AgentRecord, ClientInfo } from '../types';
import type { AuditInput } from './audit';
import { auditStmt } from './audit';
import { hit, peek } from './limits';
import { clientHashes, recordOrigin } from './origins';
import { nameKey } from './names';

// Owned by B2 (identity and signup). The functions marked as seams are called by other parts; keep their signatures.
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

/* ---------- Audit inside a batch ---------- */

/**
 * An audit entry written only if `guard` holds, so a batch that lost a race to another writer doesn't
 * record an action that never happened. `guard` is a SQL condition over state the batch changed earlier.
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
  opts: { label?: string | null; expiresInDays?: number } = {},
): Promise<{ key: IssuedKey; stmt: Stmt }> {
  const secret = randomToken('lk_');
  const id = newId('key') as IssuedKey['id'];
  const now = relay.now();
  const expires = opts.expiresInDays ? iso(new Date(now.getTime() + opts.expiresInDays * 86_400_000)) : null;
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
  const now = iso(relay.now());
  const [revoked] = await relay.db.batch([
    relay.db.prepare('UPDATE api_keys SET revoked_at = ? WHERE id = ? AND agent_id = ? AND revoked_at IS NULL').bind(now, keyId, agentId),
    auditIf(
      relay,
      { actor_type: actor.type, actor_id: actor.id, action: 'key.revoked', target_type: 'key', target_id: keyId, diff: { agent: { from: agentId, to: null } } },
      'EXISTS (SELECT 1 FROM api_keys WHERE id = ? AND revoked_at = ?)',
      keyId,
      now,
    ),
  ]);
  if (revoked!.meta.changes !== 1) throw notFound('No active key with that ID');
}

/* ---------- Authentication (seam) ---------- */

const LAST_USED_REFRESH_MS = 5 * 60_000;

/**
 * Every agent request: hash the presented key, then check the key and the agent are in good standing. Owners are optional.
 * Bookkeeping is throttled so reads stay reads: last_used_at moves at most every 5 minutes, and where the agent connects
 * from is recorded at most once a day per network.
 */
export async function authenticateKey(relay: Relay, secret: string, client: ClientInfo): Promise<AgentPrincipal> {
  if (!secret.startsWith('lk_')) throw unauthorized('Send your relay key as a Bearer token');
  const row = await relay.db
    .prepare('SELECT * FROM api_keys WHERE hash = ?')
    .bind(await sha256(secret))
    .first<KeyRow>();
  const now = relay.now();
  const nowIso = iso(now);
  if (!row || row.revoked_at || (row.expires_at && row.expires_at <= nowIso)) throw unauthorized('That key isn’t valid');
  const agent = await getAgent(relay, row.agent_id);
  if (agent.status !== 'active') throw forbidden(`This agent is ${agent.status}`);

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
}

/**
 * Moves an agent between statuses in one batch. The status update is a compare-and-set; everything after it
 * (pausing subscriptions, dropping deliveries, revoking keys, the audit entry) only applies if it took effect.
 */
async function transition(relay: Relay, agent: AgentRecord, t: Transition): Promise<AgentRecord> {
  const now = iso(relay.now());
  const applied = 'EXISTS (SELECT 1 FROM agents WHERE id = ? AND status = ? AND updated_at = ?)';
  const guard = [agent.id, t.to, now];
  const stmts: Stmt[] = [
    relay.db
      .prepare(`UPDATE agents SET status = ?, status_reason = ?, updated_at = ? WHERE id = ? AND status IN (${t.from.map(() => '?').join(', ')})`)
      .bind(t.to, t.statusReason, now, agent.id, ...t.from),
  ];
  if (t.stopDeliveries) {
    stmts.push(
      relay.db
        .prepare(`UPDATE subscriptions SET status = 'paused', paused_reason = ? WHERE agent_id = ? AND status = 'active' AND ${applied}`)
        .bind(`Agent ${t.to === 'off' ? 'turned off' : t.to}`, agent.id, ...guard),
      relay.db
        .prepare(
          `UPDATE deliveries SET status = 'dropped', next_attempt_at = NULL WHERE status IN ('pending', 'retrying') AND subscription_id IN (SELECT id FROM subscriptions WHERE agent_id = ?) AND ${applied}`,
        )
        .bind(agent.id, ...guard),
    );
  }
  if (t.revokeKeys)
    stmts.push(relay.db.prepare(`UPDATE api_keys SET revoked_at = ? WHERE agent_id = ? AND revoked_at IS NULL AND ${applied}`).bind(now, agent.id, ...guard));
  stmts.push(
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
      applied,
      ...guard,
    ),
  );
  const results = await relay.db.batch(stmts);
  if (results[0]!.meta.changes !== 1) throw conflict('This agent’s status changed while you were acting. Reload it and try again.');
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
      });
    case 'reinstate':
      if (agent.status !== 'suspended' && agent.status !== 'banned') throw conflict('Only suspended or banned agents can be reinstated.');
      return transition(relay, agent, { from: ['suspended', 'banned'], to: 'active', action: 'agent.reinstated', actor, reason, statusReason: null });
    case 'set_tier': {
      const tier = input.tier as AgentTier;
      if (agent.tier === tier) return agent;
      const now = iso(relay.now());
      const [changed] = await relay.db.batch([
        relay.db.prepare('UPDATE agents SET tier = ?, updated_at = ? WHERE id = ? AND tier = ?').bind(tier, now, agent.id, agent.tier),
        auditIf(
          relay,
          {
            actor_type: 'admin',
            actor_id: adminId,
            action: 'agent.tier_changed',
            target_type: 'agent',
            target_id: agent.id,
            reason,
            diff: { tier: { from: agent.tier, to: tier } },
          },
          'EXISTS (SELECT 1 FROM agents WHERE id = ? AND tier = ? AND updated_at = ?)',
          agent.id,
          tier,
          now,
        ),
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
    where.push(`(a.id = ? OR a.name LIKE ? ESCAPE '\\' OR ow.username LIKE ? ESCAPE '\\'${key ? " OR a.name_key LIKE ? ESCAPE '\\'" : ''})`);
    binds.push(q, `%${likeEscape(q)}%`, `%${likeEscape(q)}%`, ...(key ? [`%${likeEscape(key)}%`] : []));
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
