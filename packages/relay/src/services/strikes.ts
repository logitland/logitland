import { newId, type PolicyCode } from '@logitland/contracts';
import { iso, type Relay, type Stmt } from '../context';
import { auditStmt, type AuditInput } from './audit';
import { hit } from './limits';
import { logStmt } from './moderation/log';
import { banOriginStmts, banOwnerStmt } from './origins';
import {
  REPEAT_BLOCK_CODES,
  RULE_BLOCKS_PER_STRIKE,
  RULE_BLOCK_WINDOW_HOURS,
  STRIKE_DAYS,
  STRIKE_PAUSE_HOURS,
  STRIKE_READ_ONLY_HOURS,
} from './moderation/policy';

// The strike ladder. A strike lasts 30 days. Active strikes: 1 warning, 2 posting paused an hour,
// 3 read-only a day, 4 suspended, 5 or more banned with every key revoked.

export type Effect = 'warning' | 'paused' | 'read_only' | 'suspended' | 'banned';

export interface StrikeOutcome {
  id: string;
  /** Active strikes after this one. */
  strikes: number;
  effect: Effect;
  /** When a pause or read-only period ends. */
  until: string | null;
  /** What the agent is told, in a sentence. */
  note: string;
}

export interface Actor {
  type: 'system' | 'admin';
  id: string;
}

const HOUR = 3_600_000;

export async function activeStrikeCount(relay: Relay, agentId: string): Promise<number> {
  const row = await relay.db
    .prepare('SELECT COUNT(*) AS n FROM strikes WHERE agent_id = ? AND expires_at > ?')
    .bind(agentId, iso(relay.now()))
    .first<{ n: number }>();
  return row?.n ?? 0;
}

function ladder(n: number, now: Date): { effect: Effect; until: string | null; note: string } {
  if (n <= 1)
    return {
      effect: 'warning',
      until: null,
      note: 'That is a warning (1 active strike). Strikes expire after 30 days; a second one pauses posting for an hour.',
    };
  if (n === 2) {
    const until = iso(new Date(now.getTime() + STRIKE_PAUSE_HOURS * HOUR));
    return {
      effect: 'paused',
      until,
      note: `That is your second active strike. Posting is paused until ${until}. A third makes the agent read-only for a day.`,
    };
  }
  if (n === 3) {
    const until = iso(new Date(now.getTime() + STRIKE_READ_ONLY_HOURS * HOUR));
    return {
      effect: 'read_only',
      until,
      note: `That is your third active strike. The agent is read-only until ${until}: it can still read. A fourth suspends it.`,
    };
  }
  if (n === 4)
    return {
      effect: 'suspended',
      until: null,
      note: 'That is your fourth active strike. The agent is suspended and a person will review it. A fifth bans it.',
    };
  return { effect: 'banned', until: null, note: `That is active strike ${n}. The agent is banned and every key has been revoked.` };
}

/** Records a strike and applies what the ladder says for the new count. Every step is audited and logged. */
export async function addStrike(
  relay: Relay,
  input: { agentId: string; policy: PolicyCode; reason: string; createdBy: string; actor: Actor },
): Promise<StrikeOutcome> {
  const now = relay.now();
  const id = newId('strike');
  const audit = (a: Omit<AuditInput, 'actor_type' | 'actor_id'>) => auditStmt(relay, { actor_type: input.actor.type, actor_id: input.actor.id, ...a });
  await relay.db.batch([
    relay.db
      .prepare('INSERT INTO strikes (id, agent_id, policy_code, reason, created_by, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .bind(id, input.agentId, input.policy, input.reason, input.createdBy, iso(now), iso(new Date(now.getTime() + STRIKE_DAYS * 86_400_000))),
    audit({
      action: 'strike.added',
      target_type: 'agent',
      target_id: input.agentId,
      reason: input.reason,
      diff: { policy_code: { from: null, to: input.policy } },
    }),
  ]);

  const n = await activeStrikeCount(relay, input.agentId);
  const { effect, until, note } = ladder(n, now);
  const at = iso(now);
  const stmts: Stmt[] = [];
  if (effect === 'paused' || effect === 'read_only') {
    // Never shorten a pause that is already longer.
    stmts.push(
      relay.db
        .prepare(
          'UPDATE agents SET posting_paused_until = CASE WHEN posting_paused_until IS NULL OR posting_paused_until < ? THEN ? ELSE posting_paused_until END, status_reason = ?, updated_at = ? WHERE id = ?',
        )
        .bind(until, until, note, at, input.agentId),
    );
  } else if (effect === 'suspended' || effect === 'banned') {
    // Everything that depends on the agent not being banned yet goes before the status update, which comes last of these.
    const guard = "EXISTS (SELECT 1 FROM agents WHERE id = ? AND status != 'banned')";
    const stopped = effect === 'banned' ? 'banned' : 'suspended';
    stmts.push(
      relay.db
        .prepare(
          `UPDATE subscriptions SET status = 'paused', paused_reason = ?, paused_at = COALESCE(paused_at, ?) WHERE agent_id = ? AND status = 'active' AND ${guard}`,
        )
        .bind(`Agent ${stopped}`, at, input.agentId, input.agentId),
      relay.db
        .prepare(
          `UPDATE deliveries SET status = 'dropped', next_attempt_at = NULL WHERE status IN ('pending', 'retrying') AND subscription_id IN (SELECT id FROM subscriptions WHERE agent_id = ?) AND ${guard}`,
        )
        .bind(input.agentId, input.agentId),
    );
    if (effect === 'banned') {
      // The same operator can't just sign up again: its addresses and its owner's account are barred, as for an admin's ban.
      stmts.push(...banOriginStmts(relay, input.agentId, guard, input.agentId));
      const owner = await relay.db
        .prepare('SELECT o.discord_user_id FROM agents a JOIN owners o ON o.id = a.owner_id WHERE a.id = ?')
        .bind(input.agentId)
        .first<{ discord_user_id: string }>();
      if (owner) stmts.push(await banOwnerStmt(relay, input.agentId, owner.discord_user_id, guard, input.agentId));
    }
    stmts.push(
      relay.db
        .prepare("UPDATE agents SET status = ?, status_reason = ?, updated_at = ? WHERE id = ? AND status != 'banned'")
        .bind(stopped, note, at, input.agentId),
    );
    if (effect === 'banned')
      stmts.push(relay.db.prepare('UPDATE access_tokens SET revoked_at = ? WHERE agent_id = ? AND revoked_at IS NULL').bind(at, input.agentId));
  } else {
    stmts.push(relay.db.prepare('UPDATE agents SET status_reason = ?, updated_at = ? WHERE id = ?').bind(note, at, input.agentId));
  }
  stmts.push(
    audit({ action: `agent.${effect}`, target_type: 'agent', target_id: input.agentId, reason: note, diff: { active_strikes: { from: n - 1, to: n } } }),
  );
  stmts.push(
    logStmt(relay, input.agentId, null, {
      layer: 'enforcement',
      verdict: 'block',
      policy: input.policy,
      reason: note,
      source: `strike:${input.actor.type}`,
      latencyMs: null,
    }),
  );
  await relay.db.batch(stmts);
  return { id, strikes: n, effect, until, note };
}

/**
 * Called after a fixed rule blocked a message or an edit and the block was logged. When an agent has had
 * RULE_BLOCKS_PER_STRIKE such blocks inside the window it gets a strike, at most one a day (the counter makes that hold when
 * several requests arrive together). Returns the sentence to add to the agent's answer, or null when nothing was added.
 */
export async function escalateRuleBlocks(relay: Relay, agentId: string, policy: PolicyCode): Promise<string | null> {
  if (!REPEAT_BLOCK_CODES.has(policy)) return null;
  const codes = [...REPEAT_BLOCK_CODES];
  const since = iso(new Date(relay.now().getTime() - RULE_BLOCK_WINDOW_HOURS * HOUR));
  const row = await relay.db
    .prepare(
      // A block overturned on appeal (the message is `failed` now) no longer counts (#18).
      `SELECT COUNT(*) AS n FROM moderation_log l WHERE agent_id = ? AND layer = 'rules' AND verdict = 'block' AND created_at >= ? AND policy_code IN (${codes.map(() => '?').join(', ')})
       AND NOT EXISTS (SELECT 1 FROM relay_messages m WHERE m.id = l.message_id AND m.status = 'failed')`,
    )
    .bind(agentId, since, ...codes)
    .first<{ n: number }>();
  const n = row?.n ?? 0;
  if (n < RULE_BLOCKS_PER_STRIKE) return null;
  // At most one a day by the clock, not by a counter window that resets at midnight.
  const recent = await relay.db
    .prepare("SELECT 1 AS x FROM strikes WHERE agent_id = ? AND created_by = 'system' AND reason LIKE '% fixed-rule blocks in %' AND created_at >= ? LIMIT 1")
    .bind(agentId, since)
    .first();
  if (recent) return null;
  if (!(await hit(relay, { key: `rulestrike:${agentId}`, limit: 1, windowSeconds: RULE_BLOCK_WINDOW_HOURS * 3600 })).ok) return null;
  const strike = await addStrike(relay, {
    agentId,
    policy,
    reason: `${n} fixed-rule blocks in ${RULE_BLOCK_WINDOW_HOURS} hours`,
    createdBy: 'system',
    actor: { type: 'system', id: 'moderation' },
  });
  return `${n} messages refused by the fixed rules in a day earn a strike. ${strike.note}`;
}

/**
 * Removes a strike (an appeal was overturned). A pause or read-only period that only this strike explains is lifted
 * when the count falls below what caused it; suspensions and bans stay until an admin reinstates the agent.
 */
export async function removeStrike(relay: Relay, strikeId: string, actor: Actor, reason: string): Promise<boolean> {
  const row = await relay.db
    .prepare('SELECT agent_id, policy_code FROM strikes WHERE id = ?')
    .bind(strikeId)
    .first<{ agent_id: string; policy_code: string }>();
  if (!row) return false;
  const [del] = await relay.db.batch([
    relay.db.prepare('DELETE FROM strikes WHERE id = ?').bind(strikeId),
    auditStmt(relay, {
      actor_type: actor.type,
      actor_id: actor.id,
      action: 'strike.removed',
      target_type: 'agent',
      target_id: row.agent_id,
      reason,
      diff: { policy_code: { from: row.policy_code, to: null } },
    }),
  ]);
  if (del!.meta.changes !== 1) return false;
  const left = await activeStrikeCount(relay, row.agent_id);
  if (left < 2) {
    await relay.db
      .prepare(
        "UPDATE agents SET posting_paused_until = NULL, status_reason = CASE WHEN status = 'active' THEN NULL ELSE status_reason END, updated_at = ? WHERE id = ?",
      )
      .bind(iso(relay.now()), row.agent_id)
      .run();
  } else if (left === 2) {
    // The day-long pause came from the third strike. With two left, the pause is the hour the second one earned, counted from it.
    const newest = await relay.db
      .prepare('SELECT created_at FROM strikes WHERE agent_id = ? AND expires_at > ? ORDER BY created_at DESC LIMIT 1')
      .bind(row.agent_id, iso(relay.now()))
      .first<{ created_at: string }>();
    if (newest) {
      const cap = iso(new Date(Date.parse(newest.created_at) + STRIKE_PAUSE_HOURS * HOUR));
      await relay.db
        .prepare('UPDATE agents SET posting_paused_until = ?, updated_at = ? WHERE id = ? AND posting_paused_until > ?')
        .bind(cap, iso(relay.now()), row.agent_id, cap)
        .run();
    }
  }
  return true;
}
