import { newId, type MessageStatus, type OwnerMessage, type PolicyCode, type RelayMessage, type SendMessageRequest, type Verdict } from '@logitland/contracts';
import { iso, type Relay } from '../context';
import { sha256 } from '../crypto';
import { RelayError, conflict, invalid, notFound } from '../errors';
import type { AgentPrincipal } from '../types';
import { audit } from './audit';
import { usableChannel, type ChannelRow } from './channels';
import type { ConversationRow } from './conversation';
import { assertHoldRoom, assertMayPost, countAttempt, enforceRates, findDuplicate, holdCapError, pendingHolds } from './moderation/admission';
import { hit } from './limits';
import { Trail, writeLog } from './moderation/log';
import { checkLoop } from './moderation/loops';
import { decide, settle } from './moderation/pipeline';
import { MAX_PENDING_HOLDS, OUTAGE_BACKOFF_MINUTES, PROBATION_MAX_AUTO_ARCHIVE_MINUTES, PolicyError, isOnProbation } from './moderation/policy';
import { standingOf } from './levels';
import { contentHash, discordContent, getRow, normalise, toRelayMessage, type MessageRow } from './moderation/rows';
import { evaluateRules, judge } from './moderation/rules';
import { checkLive, checkShape, isForum, replyLine, type Target } from './moderation/target';
import { dispatch } from './sending';
import { getSettings, type Settings } from './settings';
import { escalateRuleBlocks } from './strikes';

// POST /v1/messages and what happens to a message afterwards. The order is the point:
// kill switches, channel and thread rules, the idempotency lookup, then (for a new attempt only) attempt counting,
// fixed rules, duplicates, the loop breaker, rates, the classifier, and finally the channel's send queue.

export { contentHash, toRelayMessage, type MessageRow };

export interface SendOptions {
  idempotencyKey: string;
  /** HMAC of the caller's network, for the budget shared by agents on probation. Null when the caller's address is unknown. */
  net: string | null;
}

export interface SendOutcome {
  message: RelayMessage;
  /** 201 sent, 200 refused or failed, 202 everything still in progress (queued, held, uncertain). */
  httpStatus: 200 | 201 | 202;
}

const statusFor = (s: MessageStatus): SendOutcome['httpStatus'] => (s === 'sent' ? 201 : s === 'blocked' || s === 'failed' || s === 'removed' ? 200 : 202);
const outcome = (row: MessageRow): SendOutcome => ({ message: toRelayMessage(row), httpStatus: statusFor(row.status) });

/** What a message is placed as: still moderating, or already decided by the fixed rules or the duplicate check. */
interface Placement {
  status: 'moderating' | 'blocked' | 'held';
  verdict: Verdict | null;
  policy: PolicyCode | null;
  reason: string | null;
  /** The text held a credential, so it is not kept. */
  redact?: boolean;
}

interface Draft {
  agentId: string;
  channelId: string;
  req: SendMessageRequest;
  target: Target;
  idempotencyKey: string;
  net: string | null;
  digest: string;
  /** The hash of what Discord will show, reply line included. */
  hash: string;
  /** The hash of the agent's own text alone, which the duplicate check compares. */
  textHash: string;
  /** A failed message being tried again: it is already `moderating` (we won the compare-and-set). */
  existing: MessageRow | null;
  /** The agent may post links in this channel (Embed Links, #9). */
  links: boolean;
}

/** Stores the message in the given state. Null means another request got there first (or the sweeper did). */
async function place(relay: Relay, d: Draft, to: Placement): Promise<MessageRow | null> {
  const at = iso(relay.now());
  const content = to.redact ? null : d.target.text;
  const threadName = to.redact ? null : (d.req.thread_name ?? null);
  const heldKind = to.status === 'held' ? 'review' : null;
  if (d.existing) {
    if (to.status === 'moderating') return d.existing;
    const r = await relay.db
      .prepare(
        "UPDATE relay_messages SET status = ?, verdict = ?, policy_code = ?, status_reason = ?, held_kind = ?, content = ?, thread_name = ?, updated_at = ? WHERE id = ? AND status = 'moderating'",
      )
      .bind(to.status, to.verdict, to.policy, to.reason, heldKind, content, threadName, at, d.existing.id)
      .run();
    return r.meta.changes > 0 ? getRow(relay, d.existing.id) : null;
  }
  const id = newId('message');
  const r = await relay.db
    .prepare(
      `INSERT INTO relay_messages (id, agent_id, channel_id, thread_id, thread_name, tag_ids, auto_archive_minutes, reply_to, reply_prefix, content, status, verdict, policy_code, status_reason, held_kind, idempotency_key, payload_digest, content_hash, text_hash, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT (agent_id, idempotency_key) DO NOTHING`,
    )
    .bind(
      id,
      d.agentId,
      d.channelId,
      d.req.thread_id ?? null,
      threadName,
      d.target.tagIds ? JSON.stringify(d.target.tagIds) : null,
      d.req.auto_archive_minutes ?? null,
      d.req.reply_to ?? null,
      d.target.replyPrefix,
      content,
      to.status,
      to.verdict,
      to.policy,
      to.reason,
      heldKind,
      d.idempotencyKey,
      d.digest,
      d.hash,
      d.textHash,
      at,
      at,
    )
    .run();
  return r.meta.changes > 0 ? getRow(relay, id) : null;
}

/** A concurrent request with the same key won the insert: whatever it made is the answer. */
async function winner(relay: Relay, agentId: string, key: string, digest: string): Promise<SendOutcome> {
  const row = await relay.db.prepare('SELECT * FROM relay_messages WHERE agent_id = ? AND idempotency_key = ?').bind(agentId, key).first<MessageRow>();
  if (!row) throw new RelayError(500, 'internal');
  if (row.payload_digest !== digest) throw idempotencyConflict();
  return outcome(row);
}

const idempotencyConflict = () =>
  new RelayError(
    409,
    'idempotency_conflict',
    'That Idempotency-Key was used for a different message. Use a new key for a new message, or send exactly the same one again.',
  );

export async function sendMessage(relay: Relay, principal: AgentPrincipal, req: SendMessageRequest, opts: SendOptions): Promise<SendOutcome> {
  const { agent } = principal;
  const settings = await getSettings(relay);
  const now = relay.now();
  assertMayPost(relay, agent, settings);

  const { row: channel, access } = await usableChannel(relay, agent, req.channel_id, 'send');
  const shape = checkShape(channel, access, req);
  if ((req.auto_archive_minutes ?? 0) > PROBATION_MAX_AUTO_ARCHIVE_MINUTES && isOnProbation(agent)) {
    throw invalid(`Agents on probation can keep a thread open for at most ${PROBATION_MAX_AUTO_ARCHIVE_MINUTES} minutes (a day). Use 60 or 1440.`);
  }

  const digest = await sha256(
    JSON.stringify([
      req.channel_id,
      shape.text,
      req.thread_id ?? null,
      req.thread_name ?? null,
      shape.tagIds,
      req.auto_archive_minutes ?? null,
      req.reply_to ?? null,
    ]),
  );
  const found = await relay.db
    .prepare('SELECT * FROM relay_messages WHERE agent_id = ? AND idempotency_key = ?')
    .bind(agent.id, opts.idempotencyKey)
    .first<MessageRow>();
  if (found && found.payload_digest !== digest) throw idempotencyConflict();
  if (found && found.status !== 'failed') return outcome(found);

  // Past the lookup, so repeating a request that already worked never fails because a thread or the replied-to message changed.
  await checkLive(relay, channel, req, shape.tagIds, agent.id);
  const replyPrefix = found ? found.reply_prefix : req.reply_to ? await replyLine(relay, channel, req, shape.text) : null;
  const target: Target = { ...shape, replyPrefix };
  const draft: Draft = {
    agentId: agent.id,
    channelId: req.channel_id,
    req,
    target,
    idempotencyKey: opts.idempotencyKey,
    net: opts.net,
    digest,
    hash: await contentHash(discordContent({ reply_prefix: replyPrefix, content: shape.text })),
    textHash: await contentHash(shape.text ?? ''),
    existing: null,
    links: access.embedLinks,
  };
  if (!found) return run(relay, principal, channel, settings, draft, null);
  // Only one of several concurrent retries gets to run the message again.
  const claimed = await relay.db
    .prepare(
      "UPDATE relay_messages SET status = 'moderating', verdict = NULL, policy_code = NULL, status_reason = NULL, held_kind = NULL, review_attempts = 0, next_review_at = NULL, updated_at = ? WHERE id = ? AND status = 'failed'",
    )
    .bind(iso(now), found.id)
    .run();
  if (claimed.meta.changes === 0) return outcome((await getRow(relay, found.id))!);
  return run(relay, principal, channel, settings, { ...draft, existing: (await getRow(relay, found.id))! }, found);
}

async function run(
  relay: Relay,
  { agent }: AgentPrincipal,
  channel: ChannelRow,
  settings: Settings,
  draft: Draft,
  failed: MessageRow | null,
): Promise<SendOutcome> {
  const { req } = draft;
  const trail = new Trail();
  const probation = isOnProbation(agent);
  const { limits, checks } = await standingOf(relay, agent);

  // A refusal after we took over a failed message puts it back as it was, so a later retry is not shut out.
  const refusing = async <T>(step: () => Promise<T>): Promise<T> => {
    try {
      return await step();
    } catch (err) {
      if (err instanceof PolicyError) {
        trail.add('admission', 'block', err.policy, err.detail ?? null, 'limits');
        // A flood of limit refusals is logged once a minute, so refused requests can't fill the log.
        const flood = err.status === 429 && !(await hit(relay, { key: `refusedlog:${agent.id}:m`, limit: 1, windowSeconds: 60 }, 1, true)).ok;
        if (!flood) await writeLog(relay, agent.id, draft.existing?.id ?? null, trail.entries);
      }
      if (failed) {
        await relay.db
          .prepare(
            "UPDATE relay_messages SET status = 'failed', verdict = ?, policy_code = ?, status_reason = ?, updated_at = ? WHERE id = ? AND status = 'moderating'",
          )
          .bind(failed.verdict, failed.policy_code, failed.status_reason, iso(relay.now()), failed.id)
          .run();
      }
      throw err;
    }
  };

  // Terminal decisions (fixed rules, duplicates) are stored as they are, with the whole trail behind them.
  const decided = async (to: Placement): Promise<SendOutcome> => {
    const row = await place(relay, draft, to);
    if (!row) return winner(relay, agent.id, draft.idempotencyKey, draft.digest);
    await writeLog(relay, agent.id, row.id, trail.entries);
    // Keeping on at a fixed rule earns a strike; the agent is told in the answer to this message.
    const note = to.status === 'blocked' && to.policy ? await escalateRuleBlocks(relay, agent.id, to.policy) : null;
    if (!note) return outcome(row);
    await relay.db.prepare("UPDATE relay_messages SET status_reason = COALESCE(status_reason || ' ', '') || ? WHERE id = ?").bind(note, row.id).run();
    return outcome((await getRow(relay, row.id))!);
  };

  await refusing(() => countAttempt(relay, agent.id, limits));

  const ruling = judge(evaluateRules({ content: draft.target.text ?? '', threadName: req.thread_name ?? null }, { links: draft.links, checks }));
  trail.add('rules', ruling.verdict, ruling.policy, ruling.reason, 'rules');
  if (ruling.verdict === 'hold') await refusing(() => assertHoldRoom(relay, agent.id));
  if (ruling.verdict !== 'pass') {
    return decided({
      status: ruling.verdict === 'block' ? 'blocked' : 'held',
      verdict: ruling.verdict,
      policy: ruling.policy,
      reason: ruling.reason,
      redact: ruling.redact,
    });
  }

  const dup = checks.has('duplicates')
    ? await findDuplicate(relay, {
        agentId: agent.id,
        channelId: channel.id,
        textHash: draft.textHash,
        excludeId: draft.existing?.id ?? null,
        length: normalise(draft.target.text ?? '').length,
      })
    : null;
  trail.add('limits', dup?.verdict ?? 'pass', dup?.policy ?? null, dup?.reason ?? null, 'limits');
  if (dup?.verdict === 'hold') await refusing(() => assertHoldRoom(relay, agent.id));
  if (dup) return decided({ status: dup.verdict === 'block' ? 'blocked' : 'held', verdict: dup.verdict, policy: dup.policy, reason: dup.reason });

  const conversation: ConversationRow[] = await refusing(() =>
    checkLoop(relay, {
      agentId: agent.id,
      channelId: channel.id,
      threadId: req.thread_id ?? null,
      startsThread: Boolean(req.thread_name) && isForum(channel),
      enabled: checks.has('loops'),
    }),
  );
  await refusing(() => enforceRates(relay, { agentId: agent.id, limits, probation, channel, net: draft.net, startsThread: Boolean(req.thread_name) }));
  trail.add('admission', 'pass', null, null, 'limits');

  const row = await place(relay, draft, { status: 'moderating', verdict: null, policy: null, reason: null });
  if (!row) return winner(relay, agent.id, draft.idempotencyKey, draft.digest);
  await writeLog(relay, agent.id, row.id, trail.entries);

  const decision = await decide(relay, row, agent, { probation, conversation });
  const wouldHold = decision.kind === 'hold' || (decision.kind === 'unavailable' && relay.config.moderationOutage === 'hold');
  if (wouldHold && (await pendingHolds(relay, agent.id)) >= MAX_PENDING_HOLDS) await refuseHold(relay, row, agent.id);
  if (decision.kind === 'unavailable') await outage(relay, row, agent.id, decision);
  else await settle(relay, row, agent, decision, 'moderating');

  const after = (await getRow(relay, row.id))!;
  if (after.status !== 'queued') return outcome(after);
  await dispatch(relay, after);
  return outcome((await getRow(relay, row.id))!);
}

/** The message needs a reviewer but the agent already has as many waiting as allowed: it is not accepted, and can be sent again later. */
async function refuseHold(relay: Relay, row: MessageRow, agentId: string): Promise<never> {
  const error = holdCapError();
  await relay.db
    .prepare(
      "UPDATE relay_messages SET status = 'failed', verdict = NULL, policy_code = 'rate_limit', status_reason = ?, updated_at = ? WHERE id = ? AND status = 'moderating'",
    )
    .bind(error.detail!, iso(relay.now()), row.id)
    .run();
  await writeLog(relay, agentId, row.id, [
    { layer: 'admission', verdict: 'block', policy: 'rate_limit', reason: error.detail!, source: 'limits', latencyMs: null },
  ]);
  throw error;
}

/** Nothing answered. Hold the message for an automatic re-check, or refuse it, as the relay is configured. */
async function outage(relay: Relay, row: MessageRow, agentId: string, d: { reason: string; source: string; latencyMs: number }): Promise<void> {
  const at = iso(relay.now());
  const log = (verdict: 'hold' | 'block', reason: string) =>
    writeLog(relay, agentId, row.id, [
      { layer: 'classifier', verdict, policy: 'outage', reason: `${reason} (${d.reason})`, source: d.source, latencyMs: d.latencyMs },
    ]);
  if (relay.config.moderationOutage === 'refuse') {
    const reason = 'Moderation is unavailable, so nothing was posted. Send it again later with the same Idempotency-Key.';
    await relay.db
      .prepare("UPDATE relay_messages SET status = 'failed', policy_code = 'outage', status_reason = ?, updated_at = ? WHERE id = ? AND status = 'moderating'")
      .bind(reason, at, row.id)
      .run();
    await log('block', reason);
    throw new PolicyError(503, 'moderation_unavailable', 'outage', reason, { retryAfterSeconds: 30 });
  }
  const reason =
    'Moderation is temporarily unavailable, so this message is held. It is checked again automatically and sent if it passes; you don’t need to do anything.';
  const next = iso(new Date(relay.now().getTime() + OUTAGE_BACKOFF_MINUTES[0] * 60_000));
  const r = await relay.db
    .prepare(
      "UPDATE relay_messages SET status = 'held', verdict = 'hold', policy_code = 'outage', status_reason = ?, held_kind = 'outage', review_attempts = 0, next_review_at = ?, updated_at = ? WHERE id = ? AND status = 'moderating'",
    )
    .bind(reason, next, at, row.id)
    .run();
  if (r.meta.changes > 0) await log('hold', reason);
}

/** The agent's own message, or 404. */
export async function getOwnMessage(relay: Relay, agentId: string, id: string): Promise<RelayMessage> {
  const row = await getRow(relay, id);
  if (!row || row.agent_id !== agentId) throw notFound('No such message');
  return toRelayMessage(row);
}

/* ---------- The owner's view ---------- */

type OwnerRow = MessageRow & { agent_name: string };
const toOwnerMessage = (r: OwnerRow): OwnerMessage => ({ ...toRelayMessage(r), agent_name: r.agent_name, thread_name: r.thread_name });

export async function listOwnerMessages(
  relay: Relay,
  ownerId: string,
  q: { status?: MessageStatus; before?: string; limit: number },
): Promise<{ messages: OwnerMessage[]; next_before: string | null }> {
  const where = ['a.owner_id = ?'];
  const args: unknown[] = [ownerId];
  if (q.status) {
    where.push('m.status = ?');
    args.push(q.status);
  }
  if (q.before) {
    where.push('m.id < ?');
    args.push(q.before);
  }
  const { results } = await relay.db
    .prepare(
      `SELECT m.*, a.name AS agent_name FROM relay_messages m JOIN agents a ON a.id = m.agent_id WHERE ${where.join(' AND ')} ORDER BY m.id DESC LIMIT ?`,
    )
    .bind(...args, q.limit)
    .all<OwnerRow>();
  return { messages: results.map(toOwnerMessage), next_before: results.length === q.limit ? results[results.length - 1]!.id : null };
}
