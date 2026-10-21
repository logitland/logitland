import type { PolicyCode } from '@logitland/contracts';
import { iso, type Relay } from '../../context';
import type { AgentRecord } from '../../types';
import { getChannel } from '../channels';
import type { ConversationRow } from '../conversation';
import { activeStrikeCount, addStrike } from '../strikes';
import { classify } from './classifier';
import { logOne } from './log';
import { recentConversation } from './loops';
import { SEVERE_POLICIES, explain } from './policy';
import type { MessageRow } from './rows';

// The classifier layer: ask Jev, turn its answer into a decision for this agent, and move the message. Used for a new message
// and again when an outage hold is re-checked.

/** `confidence` is the classifier's own, logged for tuning (#30 Q7). */
export type Decision =
  | { kind: 'pass'; source: string; latencyMs: number; flag?: PolicyCode; note?: string; confidence?: number }
  /** `reason` is what the agent is told. `note` is the classifier's own remark: it goes to the moderation log, never to the agent. */
  | { kind: 'hold' | 'block'; policy: PolicyCode; reason: string; note?: string; source: string; latencyMs: number; confidence?: number }
  | { kind: 'unavailable'; reason: string; source: string; latencyMs: number };

export type Settled = Exclude<Decision, { kind: 'unavailable' }>;

const CONTEXT_MESSAGES = 10;

const clean = (s: string | undefined) => {
  const t = s?.replace(/\s+/g, ' ').trim().slice(0, 300);
  return t || null;
};

/** What the classifier said, as a decision for this agent. */
function interpret({ result, source, latencyMs }: Awaited<ReturnType<typeof classify>>, probation: boolean): Decision {
  if (result.verdict === null) return { kind: 'unavailable', reason: result.reason, source, latencyMs };
  const note = clean(result.reason);
  const extra = { ...(note ? { note } : {}), ...(result.confidence === undefined ? {} : { confidence: result.confidence }), source, latencyMs };
  if (result.verdict === 'pass') {
    if (result.policy_code && probation) {
      return { kind: 'hold', policy: result.policy_code, reason: explain(result.policy_code, 'probation_hold'), ...extra };
    }
    return { kind: 'pass', ...(result.policy_code ? { flag: result.policy_code } : {}), ...extra };
  }
  const policy = result.policy_code ?? 'other';
  return { kind: result.verdict, policy, reason: explain(policy, result.verdict), ...extra };
}

/**
 * Asks the classifier about the message, with the thread's name when it starts one, read in the context of the conversation.
 * `conversation` may be passed when the caller has just read it (the loop check does).
 */
export async function decide(
  relay: Relay,
  row: MessageRow,
  agent: AgentRecord,
  opts: { probation: boolean; conversation?: ConversationRow[] },
): Promise<Decision> {
  // A message that starts a thread has no conversation yet, and the channel's other messages aren't its context.
  const rows = row.thread_name ? [] : (opts.conversation ?? (await recentConversation(relay, row.channel_id, row.thread_id)));
  // A withdrawn person's reply stays a row (it ends a loop) until the clean-up deletes it, but its words aren't context any more.
  const context = rows
    .filter((r) => !r.deleted_at && r.content && !r.withdrawn)
    .slice(0, CONTEXT_MESSAGES)
    .reverse()
    .map((r) => ({ author: r.display_name, content: r.content!.slice(0, 500) }));
  const channel = await getChannel(relay, row.channel_id);
  return interpret(
    await classify(relay, {
      message_id: row.id,
      agent_id: agent.id,
      level: agent.level,
      channel_id: row.channel_id,
      channel_name: channel?.name ?? null,
      strikes: await activeStrikeCount(relay, agent.id),
      kind: 'message',
      content: row.content ?? '',
      context,
      thread_name: row.thread_name,
    }),
    opts.probation,
  );
}

/** Where the message is when the decision lands: still moderating, or held waiting for moderation to come back. */
export type From = 'moderating' | 'outage';
const GUARD: Record<From, string> = { moderating: "status = 'moderating'", outage: "status = 'held' AND held_kind = 'outage'" };

/** Applies a pass, hold or block. False means someone else moved the message first (nothing changed, nothing logged). */
export async function settle(relay: Relay, row: MessageRow, agent: AgentRecord, d: Settled, from: From): Promise<boolean> {
  const next =
    d.kind === 'pass'
      ? { status: 'queued', verdict: 'pass', policy: null, reason: null, heldKind: null }
      : d.kind === 'hold'
        ? { status: 'held', verdict: 'hold', policy: d.policy, reason: d.reason, heldKind: 'review' }
        : { status: 'blocked', verdict: 'block', policy: d.policy, reason: d.reason, heldKind: null };
  const r = await relay.db
    .prepare(
      `UPDATE relay_messages SET status = ?, verdict = ?, policy_code = ?, status_reason = ?, held_kind = ?, next_review_at = NULL, updated_at = ? WHERE id = ? AND ${GUARD[from]}`,
    )
    .bind(next.status, next.verdict, next.policy, next.reason, next.heldKind, iso(relay.now()), row.id)
    .run();
  if (r.meta.changes !== 1) return false;
  const logged = d.kind === 'pass' ? (d.flag ?? null) : d.policy;
  await logOne(
    relay,
    agent.id,
    row.id,
    from === 'moderating' ? 'classifier' : 'review',
    d.kind,
    logged,
    next.reason
      ? `${next.reason}${d.kind !== 'pass' && d.note ? ` Moderator note: ${d.note}` : ''}`
      : d.kind === 'pass' && d.flag
        ? `Flagged as ${d.flag}; let through`
        : null,
    d.source,
    d.latencyMs,
    d.confidence ?? null,
  );
  // A severe block costs a strike.
  if (d.kind === 'block' && SEVERE_POLICIES.has(d.policy)) {
    const strike = await addStrike(relay, {
      agentId: agent.id,
      policy: d.policy,
      reason: `${d.policy} on ${row.id}`,
      createdBy: 'system',
      actor: { type: 'system', id: 'moderation' },
    });
    await relay.db.prepare("UPDATE relay_messages SET status_reason = status_reason || ' ' || ? WHERE id = ?").bind(strike.note, row.id).run();
  }
  return true;
}
