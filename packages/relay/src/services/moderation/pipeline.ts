import type { PolicyCode } from '@logitland/contracts';
import { iso, type Relay } from '../../context';
import type { AgentRecord } from '../../types';
import type { ConversationRow } from '../conversation';
import { activeStrikeCount, addStrike } from '../strikes';
import { classify } from './classifier';
import { logOne } from './log';
import { recentConversation } from './loops';
import { SEVERE_POLICIES, explain } from './policy';
import { parsePoll, type MessageRow } from './rows';

// The classifier layer: ask Jev/Laya (then Workers AI), turn its answer into a decision for this agent,
// and move the message. Used for a new message and again when an outage hold is re-checked.

export type Decision =
  | { kind: 'pass'; source: string; latencyMs: number; flag?: PolicyCode }
  /** `reason` is what the agent is told. `note` is the classifier's own remark: it goes to the moderation log, never to the agent. */
  | { kind: 'hold' | 'block'; policy: PolicyCode; reason: string; note?: string; source: string; latencyMs: number }
  | { kind: 'unavailable'; reason: string; source: string; latencyMs: number };

export type Settled = Exclude<Decision, { kind: 'unavailable' }>;

const CONTEXT_MESSAGES = 10;

const clean = (s: string | undefined) => {
  const t = s?.replace(/\s+/g, ' ').trim().slice(0, 300);
  return t || null;
};

/** The words the classifier reads for a message: its text, then the poll's question and answers. */
export function moderationText(row: Pick<MessageRow, 'content' | 'poll'>): string {
  const poll = parsePoll(row);
  const lines = poll ? [`Poll: ${poll.question}`, ...poll.answers.map((a) => `- ${a}`)] : [];
  return [row.content, lines.join('\n')].filter(Boolean).join('\n\n');
}

/** What the classifier said, as a decision for this agent. */
function interpret({ result, source, latencyMs }: Awaited<ReturnType<typeof classify>>, probation: boolean): Decision {
  if (result.verdict === null) return { kind: 'unavailable', reason: result.reason, source, latencyMs };
  if (result.verdict === 'pass') {
    if (result.policy_code && probation) {
      return { kind: 'hold', policy: result.policy_code, reason: explain(result.policy_code, 'probation_hold'), source, latencyMs };
    }
    return { kind: 'pass', source, latencyMs, ...(result.policy_code ? { flag: result.policy_code } : {}) };
  }
  const policy = result.policy_code ?? 'other';
  const note = clean(result.reason);
  return { kind: result.verdict, policy, reason: explain(policy, result.verdict), ...(note ? { note } : {}), source, latencyMs };
}

/** A block is final, then no answer at all (it will be asked again), then a hold, then a pass. */
function worse(a: Decision, b: Decision): Decision {
  const rank = (d: Decision) => ({ block: 3, unavailable: 2, hold: 1, pass: 0 })[d.kind];
  return rank(b) > rank(a) ? b : a;
}

/**
 * Asks the classifier about the message (its text and poll, read in the context of the conversation), and, when it starts a
 * thread, about the thread's name on its own. `conversation` may be passed when the caller has just read it (the loop check does).
 */
export async function decide(
  relay: Relay,
  row: MessageRow,
  agent: AgentRecord,
  opts: { probation: boolean; conversation?: ConversationRow[] },
): Promise<Decision> {
  // A message that starts a thread has no conversation yet, and the channel's other messages aren't its context. What goes
  // to the classifier never includes a person who hadn't agreed to the mirror when they wrote it (their rows are hidden).
  const rows = row.thread_name ? [] : (opts.conversation ?? (await recentConversation(relay, row.channel_id, row.thread_id)));
  const context = rows
    .filter((r) => !r.deleted_at && r.content && !(r.author_kind === 'human' && (r.withheld === 1 || !r.consented)))
    .slice(0, CONTEXT_MESSAGES)
    .reverse()
    .map((r) => ({ author: r.display_name, content: r.content!.slice(0, 500) }));
  const base = { message_id: row.id, agent_id: agent.id, tier: agent.tier, channel_id: row.channel_id, strikes: await activeStrikeCount(relay, agent.id) };
  const message = interpret(
    await classify(relay, { ...base, kind: 'message', content: moderationText(row), context, thread_name: row.thread_name }),
    opts.probation,
  );
  if (!row.thread_name || message.kind === 'block') return message;
  const title = interpret(await classify(relay, { ...base, kind: 'thread_name', content: row.thread_name }), opts.probation);
  return worse(message, title);
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
  );
  // Strikes come from Jev/Laya and from admins. The fallback model may block a message, but it never costs an agent a strike.
  if (d.kind === 'block' && d.source === 'primary' && SEVERE_POLICIES.has(d.policy)) {
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
