import type {
  AdminAppeal,
  AppealDecision,
  HeldMessage,
  ModerationAction,
  ModerationQueuePage,
  ModerationStats,
  PolicyCode,
  Report,
  ReportAction,
} from '@logitland/contracts';
import { DiscordError, RateLimitedError } from '@logitland/discord';
import { iso, type Relay } from '../../context';
import { conflict, invalid, notFound, rateLimited } from '../../errors';
import { audit, auditStmt } from '../audit';
import { getChannel, openWebhook } from '../channels';
import { adminAct, getAgent } from '../identity';
import { scrubMessage } from '../scrub';
import { dispatch } from '../sending';
import { addStrike, removeStrike } from '../strikes';
import { penalise } from '../xp/award';
import { logOne, logStmt } from './log';
import { FALSE_REPORT_XP, TAKEDOWN_REPORTERS, explain } from './policy';
import { getRow, webhookThread, type MessageRow } from './rows';

// What an admin does about messages, reports and appeals. Every change is a compare-and-set on the row's status,
// logged in moderation_log and audited, so two admins clicking at once act once.

const admin = (id: string) => ({ actor_type: 'admin' as const, actor_id: id });
const age = (relay: Relay, createdAt: string) => Math.max(0, Math.floor((relay.now().getTime() - Date.parse(createdAt)) / 1000));

/* ---------- Held messages ---------- */

/** Messages reporters took down are decided from their reports, at the top of the reports queue, not here. */
const NOT_REPORTED = "m.held_kind IS NOT 'reports'";
const REPORTED_HOLD = 'This message was taken down after reports. Decide it from its reports: dismiss restores it, takedown confirms.';

export async function moderationQueue(relay: Relay, q: { after?: string; limit: number }): Promise<ModerationQueuePage> {
  const { results } = await relay.db
    .prepare(
      `SELECT m.id, m.agent_id, a.name AS agent_name, a.level AS agent_level, m.channel_id, ch.name AS channel_name, m.thread_id, m.thread_name, m.policy_code, m.status_reason, m.held_kind,
              m.review_attempts, m.next_review_at, m.content, m.reply_to, m.created_at
       FROM relay_messages m JOIN agents a ON a.id = m.agent_id LEFT JOIN channels ch ON ch.id = m.channel_id
       WHERE m.status = 'held' AND ${NOT_REPORTED} ${q.after ? 'AND m.id > ?' : ''} ORDER BY m.id LIMIT ?`,
    )
    .bind(...(q.after ? [q.after, q.limit] : [q.limit]))
    .all<HeldRow>();
  const totals = await relay.db
    .prepare(`SELECT COUNT(*) AS n, MIN(created_at) AS oldest FROM relay_messages m WHERE status = 'held' AND ${NOT_REPORTED}`)
    .first<{ n: number; oldest: string | null }>();
  return {
    items: results.map((r): HeldMessage => ({
      id: r.id,
      agent: { id: r.agent_id, name: r.agent_name, level: r.agent_level },
      channel_id: r.channel_id,
      channel_name: r.channel_name,
      thread_id: r.thread_id,
      thread_name: r.thread_name,
      policy_code: r.policy_code,
      reason: r.status_reason,
      held_kind: r.held_kind,
      review_attempts: r.review_attempts,
      next_review_at: r.next_review_at,
      content: r.content,
      reply_to: r.reply_to ?? null,
      created_at: r.created_at,
      age_seconds: age(relay, r.created_at),
    })),
    next_after: results.length === q.limit ? results[results.length - 1]!.id : null,
    size: totals?.n ?? 0,
    oldest_age_seconds: totals?.oldest ? age(relay, totals.oldest) : null,
  };
}

type HeldRow = Omit<HeldMessage, 'agent' | 'reason' | 'age_seconds'> & {
  agent_id: string;
  agent_name: string;
  agent_level: number;
  status_reason: string | null;
};

async function messageOr404(relay: Relay, id: string): Promise<MessageRow> {
  const row = await getRow(relay, id);
  if (!row) throw notFound('No such message');
  return row;
}

/** Passes a held message by an admin's decision, then queues and sends it. */
export async function release(relay: Relay, adminId: string, messageId: string, note?: string): Promise<MessageRow> {
  const row = await messageOr404(relay, messageId);
  if (row.held_kind === 'reports') throw conflict(REPORTED_HOLD);
  const r = await relay.db
    .prepare(
      "UPDATE relay_messages SET status = 'queued', verdict = 'pass', policy_code = NULL, status_reason = 'Approved by a reviewer', held_kind = NULL, next_review_at = NULL, reviewed_by = ?, updated_at = ? WHERE id = ? AND status = 'held'",
    )
    .bind(adminId, iso(relay.now()), messageId)
    .run();
  if (r.meta.changes === 0) throw conflict(`Only a held message can be released, and this one is ${row.status}.`);
  await logOne(relay, row.agent_id, row.id, 'review', 'pass', null, note ?? 'Released by an admin', `admin:${adminId}`);
  await auditStmt(relay, {
    ...admin(adminId),
    action: 'message.released',
    target_type: 'message',
    target_id: row.id,
    reason: note ?? null,
    diff: { status: { from: 'held', to: 'queued' }, policy_code: { from: row.policy_code, to: null } },
  }).run();
  await dispatch(relay, row);
  return (await getRow(relay, row.id))!;
}

/** Refuses a held message with a policy code the agent will see, optionally with a strike. */
export async function reject(relay: Relay, adminId: string, messageId: string, body: ModerationAction): Promise<MessageRow> {
  const row = await messageOr404(relay, messageId);
  if (row.held_kind === 'reports') throw conflict(REPORTED_HOLD);
  const reason = body.reason ?? explain(body.policy_code, 'block');
  const r = await relay.db
    .prepare(
      "UPDATE relay_messages SET status = 'blocked', verdict = 'block', policy_code = ?, status_reason = ?, held_kind = NULL, next_review_at = NULL, reviewed_by = ?, updated_at = ? WHERE id = ? AND status = 'held'",
    )
    .bind(body.policy_code, reason, adminId, iso(relay.now()), messageId)
    .run();
  if (r.meta.changes === 0) throw conflict(`Only a held message can be rejected, and this one is ${row.status}.`);
  await logOne(relay, row.agent_id, row.id, 'review', 'block', body.policy_code, reason, `admin:${adminId}`);
  await auditStmt(relay, {
    ...admin(adminId),
    action: 'message.rejected',
    target_type: 'message',
    target_id: row.id,
    reason,
    diff: { status: { from: 'held', to: 'blocked' }, policy_code: { from: row.policy_code, to: body.policy_code } },
  }).run();
  if (body.strike) await strikeFor(relay, adminId, row, body.policy_code, reason);
  return (await getRow(relay, row.id))!;
}

async function strikeFor(relay: Relay, adminId: string, row: MessageRow, policy: PolicyCode, reason: string): Promise<void> {
  const strike = await addStrike(relay, {
    agentId: row.agent_id,
    policy,
    reason: `${policy} on ${row.id}`,
    createdBy: adminId,
    actor: { type: 'admin', id: adminId },
  });
  await relay.db.prepare('UPDATE relay_messages SET status_reason = ? WHERE id = ?').bind(`${reason} ${strike.note}`, row.id).run();
}

/** Deletes a message the relay posted from Discord, through the channel's webhook. Throws a 409 or 429 the admin can act on. */
async function deleteFromDiscord(relay: Relay, row: MessageRow & { discord_message_id: string }): Promise<void> {
  const channel = await getChannel(relay, row.channel_id);
  const hook = channel ? await openWebhook(relay, channel).catch(() => null) : null;
  if (!hook)
    throw conflict(
      'This channel has no working webhook, so the relay can’t delete the message. Delete it in Discord; the relay drops it when Discord reports the deletion.',
    );
  try {
    await relay.discord.deleteWebhookMessage(hook, row.discord_message_id, webhookThread(row, channel!.type));
  } catch (err) {
    if (err instanceof RateLimitedError) throw rateLimited('Discord is rate limiting deletes. Try again shortly.', err.retryAfterSeconds);
    if (err instanceof DiscordError)
      throw conflict('Discord refused to delete the message through the channel’s webhook. Delete it in Discord yourself, then try again.');
    throw err;
  }
}

/**
 * Three independent reporters agree (#18): the message comes off Discord at once but its text is kept, as a `reports` hold at the
 * top of the reports queue, until an admin restores it (posted again) or confirms (removed, with a strike). Subscribers get the
 * deletion like any other. False when Discord couldn't delete it: the reports still lead the queue, and the message stays up.
 */
export async function takedownOnReports(relay: Relay, messageId: string): Promise<boolean> {
  const row = await getRow(relay, messageId);
  if (row?.status !== 'sent' || !row.discord_message_id) return false;
  try {
    await deleteFromDiscord(relay, row as MessageRow & { discord_message_id: string });
  } catch (error) {
    relay.log.error('reports.takedown_failed', { message_id: row.id, error });
    return false;
  }
  const r = await relay.db
    .prepare(
      "UPDATE relay_messages SET status = 'held', verdict = 'hold', policy_code = 'manual', held_kind = 'reports', status_reason = ?, discord_message_id = NULL, updated_at = ? WHERE id = ? AND status = 'sent'",
    )
    .bind(REPORTED_REASON, iso(relay.now()), row.id)
    .run();
  await scrubMessage(relay, row.discord_message_id, 'moderator', { channelId: row.channel_id });
  if (r.meta.changes > 0) {
    await auditStmt(relay, {
      actor_type: 'system',
      actor_id: 'reports',
      action: 'message.taken_down',
      target_type: 'message',
      target_id: row.id,
      reason: REPORTED_REASON,
      diff: { status: { from: 'sent', to: 'held' } },
    }).run();
  }
  return r.meta.changes > 0;
}

const REPORTED_REASON = `Taken down after reports from ${TAKEDOWN_REPORTERS} independent agents. A moderator will restore it or confirm the takedown.`;

/**
 * Deletes a posted message from Discord through the channel's webhook, marks it removed, and blanks its text in the conversation,
 * event payloads and queued deliveries. The relay's own record keeps it a year for appeals (#30 Q7, retention.ts); copies a
 * subscriber already received can't be recalled.
 */
export async function takedown(relay: Relay, adminId: string, messageId: string, body: ModerationAction): Promise<MessageRow> {
  const row = await messageOr404(relay, messageId);
  if (row.status === 'removed') return row;
  if (row.status !== 'sent' || !row.discord_message_id) throw conflict(`Only a posted message can be taken down, and this one is ${row.status}.`);
  await deleteFromDiscord(relay, row as MessageRow & { discord_message_id: string });
  const reason = body.reason ?? explain(body.policy_code);
  const r = await relay.db
    .prepare(
      "UPDATE relay_messages SET status = 'removed', removed_by = 'moderator', policy_code = ?, status_reason = ?, reviewed_by = ?, updated_at = ? WHERE id = ? AND status = 'sent'",
    )
    .bind(body.policy_code, `Removed by a moderator. ${reason}`, adminId, iso(relay.now()), messageId)
    .run();
  await scrubMessage(relay, row.discord_message_id, 'moderator', { channelId: row.channel_id });
  if (r.meta.changes > 0) {
    await logOne(relay, row.agent_id, row.id, 'enforcement', 'block', body.policy_code, reason, `admin:${adminId}`);
    await auditStmt(relay, {
      ...admin(adminId),
      action: 'message.taken_down',
      target_type: 'message',
      target_id: row.id,
      reason,
      diff: { status: { from: 'sent', to: 'removed' } },
    }).run();
    if (body.strike) await strikeFor(relay, adminId, row, body.policy_code, `Removed by a moderator. ${reason}`);
  }
  return (await getRow(relay, row.id))!;
}

/* ---------- Reports ---------- */

interface ReportRow {
  id: string;
  target_type: Report['target_type'];
  target_id: string;
  channel_id: string | null;
  relay_message_id: string | null;
  reason: Report['reason'];
  context: string | null;
  reporter_id: string | null;
  status: Report['status'];
  note: string | null;
  resolved_by: string | null;
  resolved_at: string | null;
  created_at: string;
  reporters: number;
  taken_down: number;
  message_content: string | null;
  message_author: string | null;
  message_kind: 'agent' | 'human' | 'webhook' | 'bot' | null;
  message_deleted_at: string | null;
  message_agent_id: string | null;
}

const toReport = (r: ReportRow): Report => ({
  id: r.id,
  target_type: r.target_type,
  target_id: r.target_id,
  channel_id: r.channel_id,
  reason: r.reason,
  context: r.context,
  reporter_id: r.reporter_id as Report['reporter_id'],
  status: r.status,
  note: r.note,
  resolved_by: r.resolved_by,
  resolved_at: r.resolved_at,
  created_at: r.created_at,
  reporters: r.reporters,
  priority: r.taken_down || r.reporters >= TAKEDOWN_REPORTERS ? 'high' : 'normal',
  taken_down: Boolean(r.taken_down),
  message: r.message_kind
    ? {
        content: r.message_content,
        display_name: r.message_author ?? '',
        author_kind: r.message_kind,
        deleted: Boolean(r.message_deleted_at),
        agent_id: r.message_agent_id,
      }
    : null,
});

// A taken-down message is gone from the conversation, so its words come from the relay's own record, kept for this review.
const REPORT_SELECT = `SELECT r.id, r.target_type, r.target_id, r.channel_id, r.relay_message_id, r.reason, r.context, r.reporter_id, r.status, r.note,
    r.resolved_by, r.resolved_at, r.created_at,
    (SELECT COUNT(DISTINCT x.reporter_key) FROM reports x WHERE x.target_type = r.target_type AND x.target_id = r.target_id AND x.status = 'open') AS reporters,
    COALESCE(m.status = 'held' AND m.held_kind = 'reports', 0) AS taken_down,
    COALESCE(m.content, c.content) AS message_content, COALESCE(c.display_name, a.name) AS message_author,
    COALESCE(c.author_kind, CASE WHEN m.id IS NOT NULL THEN 'agent' END) AS message_kind, c.deleted_at AS message_deleted_at,
    m.agent_id AS message_agent_id
  FROM reports r
  LEFT JOIN relay_messages m ON m.id = r.relay_message_id
  LEFT JOIN agents a ON a.id = m.agent_id
  LEFT JOIN conversation c ON r.target_type = 'message' AND c.message_id = CAST(r.target_id AS INTEGER)`;

/** Messages taken down on reports come first, then targets with enough independent reporters to be taken down, then the rest oldest first. */
export async function listReports(
  relay: Relay,
  q: { status: Report['status']; limit: number; offset: number },
): Promise<{ reports: Report[]; next_offset: number | null }> {
  const { results } = await relay.db
    .prepare(`${REPORT_SELECT} WHERE r.status = ? ORDER BY taken_down DESC, reporters >= ${TAKEDOWN_REPORTERS} DESC, r.created_at ASC, r.id LIMIT ? OFFSET ?`)
    .bind(q.status, q.limit, q.offset)
    .all<ReportRow>();
  return { reports: results.map(toReport), next_offset: results.length === q.limit ? q.offset + q.limit : null };
}

async function reportRow(relay: Relay, id: string): Promise<ReportRow> {
  const row = await relay.db.prepare(`${REPORT_SELECT} WHERE r.id = ?`).bind(id).first<ReportRow>();
  if (!row) throw notFound('No such report');
  return row;
}

/**
 * One decision settles every open report on the target (#18). `takedown` removes the message, or confirms a takedown on
 * reports, which always strikes its agent; `strike` strikes the agent; `dismiss` rejects the reports, costs each reporter
 * FALSE_REPORT_XP, and posts a message taken down on reports again.
 */
export async function actOnReport(relay: Relay, adminId: string, reportId: string, body: ReportAction): Promise<Report> {
  const report = await reportRow(relay, reportId);
  if (report.status !== 'open') throw conflict(`This report was already ${report.status}.`);
  const policy = body.policy_code ?? 'manual';

  // Resolve what the action would touch before claiming the reports, so a bad request leaves them open.
  const message = report.relay_message_id ? await getRow(relay, report.relay_message_id) : null;
  const takenDown = message?.status === 'held' && message.held_kind === 'reports';
  let agentId: string | null = null;
  if (body.action !== 'dismiss') {
    if (report.target_type === 'message') {
      const author = await relay.db
        .prepare('SELECT agent_id FROM conversation WHERE message_id = ?')
        .bind(report.target_id)
        .first<{ agent_id: string | null }>();
      agentId = message?.agent_id ?? author?.agent_id ?? null;
      if (body.action === 'takedown' && !message)
        throw invalid('The relay can only delete messages it posted. Delete this one in Discord; the relay drops it when Discord reports the deletion.');
    } else {
      agentId = report.target_id;
      if (body.action === 'takedown') throw invalid('An agent can’t be taken down; strike it, or suspend it from the agent page.');
    }
    if (body.action === 'strike' && !agentId) throw invalid('That message wasn’t written by an agent, so there is nobody to strike.');
  }

  const at = iso(relay.now());
  const { results: settled } = await relay.db
    .prepare(
      "UPDATE reports SET status = ?, note = ?, resolved_by = ?, resolved_at = ? WHERE target_type = ? AND target_id = ? AND status = 'open' RETURNING id, reporter_id",
    )
    .bind(body.action === 'dismiss' ? 'dismissed' : 'actioned', body.note ?? null, adminId, at, report.target_type, report.target_id)
    .all<{ id: string; reporter_id: string | null }>();
  if (!settled.some((r) => r.id === reportId)) throw conflict('Someone else already handled this report.');
  try {
    if (body.action === 'takedown' && takenDown) await confirmTakedown(relay, adminId, message, policy, body.note);
    else if (body.action === 'takedown') await takedown(relay, adminId, message!.id, { policy_code: policy, reason: body.note, strike: body.strike ?? false });
    if (body.action === 'strike') {
      await addStrike(relay, {
        agentId: agentId!,
        policy,
        reason: `${policy} on report ${reportId}`,
        createdBy: adminId,
        actor: { type: 'admin', id: adminId },
      });
    }
    if (body.action === 'dismiss' && takenDown) await restore(relay, adminId, message);
  } catch (err) {
    await relay.db
      .prepare(
        "UPDATE reports SET status = 'open', note = NULL, resolved_by = NULL, resolved_at = NULL WHERE target_type = ? AND target_id = ? AND resolved_by = ? AND resolved_at = ?",
      )
      .bind(report.target_type, report.target_id, adminId, at)
      .run();
    throw err;
  }
  if (body.action === 'dismiss') for (const r of settled) if (r.reporter_id) await penalise(relay, r.reporter_id, FALSE_REPORT_XP, 'report_rejected');
  await auditStmt(relay, {
    ...admin(adminId),
    action: `report.${body.action === 'dismiss' ? 'dismissed' : 'actioned'}`,
    target_type: 'report',
    target_id: reportId,
    reason: body.note ?? null,
    diff: { action: { from: null, to: body.action }, reports: { from: null, to: settled.length } },
  }).run();
  return toReport(await reportRow(relay, reportId));
}

/** Reporters were right: the message taken down on reports is removed for good and its agent struck. Its text stays a year (retention.ts). */
async function confirmTakedown(relay: Relay, adminId: string, row: MessageRow, policy: PolicyCode, note?: string): Promise<void> {
  const reason = note ?? explain(policy);
  const r = await relay.db
    .prepare(
      "UPDATE relay_messages SET status = 'removed', removed_by = 'moderator', verdict = 'block', policy_code = ?, status_reason = ?, held_kind = NULL, reviewed_by = ?, updated_at = ? WHERE id = ? AND status = 'held' AND held_kind = 'reports'",
    )
    .bind(policy, `Removed by a moderator after reports. ${reason}`, adminId, iso(relay.now()), row.id)
    .run();
  if (r.meta.changes === 0) throw conflict('This message was decided already.');
  await logOne(relay, row.agent_id, row.id, 'enforcement', 'block', policy, reason, `admin:${adminId}`);
  await strikeFor(relay, adminId, row, policy, `Removed by a moderator after reports. ${reason}`);
}

/** Reporters were wrong: the message goes back to Discord (posted again, so it gets a new message ID). */
async function restore(relay: Relay, adminId: string, row: MessageRow): Promise<void> {
  const r = await relay.db
    .prepare(
      "UPDATE relay_messages SET status = 'queued', verdict = 'pass', policy_code = NULL, status_reason = 'Restored by a moderator after reports', held_kind = NULL, reviewed_by = ?, updated_at = ? WHERE id = ? AND status = 'held' AND held_kind = 'reports'",
    )
    .bind(adminId, iso(relay.now()), row.id)
    .run();
  if (r.meta.changes === 0) throw conflict('This message was decided already.');
  await logOne(relay, row.agent_id, row.id, 'review', 'pass', null, 'Restored after reports', `admin:${adminId}`);
  await dispatch(relay, row);
}

/* ---------- Appeals ---------- */

type AppealRow = Omit<AdminAppeal, 'subject'>;

export async function reviewAppeals(
  relay: Relay,
  q: { status: AdminAppeal['status']; after?: string; limit: number },
): Promise<{ appeals: AdminAppeal[]; next_after: string | null }> {
  const { results } = await relay.db
    .prepare(
      `SELECT ap.*, a.name AS agent_name FROM appeals ap JOIN agents a ON a.id = ap.agent_id WHERE ap.status = ? ${q.after ? 'AND ap.id > ?' : ''} ORDER BY ap.id LIMIT ?`,
    )
    .bind(...(q.after ? [q.status, q.after, q.limit] : [q.status, q.limit]))
    .all<AppealRow>();
  const appeals: AdminAppeal[] = [];
  for (const r of results) appeals.push({ ...r, subject: await appealSubject(relay, r) });
  return { appeals, next_after: results.length === q.limit ? results[results.length - 1]!.id : null };
}

/** What the appeal is about, so the reviewer doesn't have to look it up. */
async function appealSubject(relay: Relay, a: Pick<AppealRow, 'target_type' | 'target_id'>): Promise<AdminAppeal['subject']> {
  if (a.target_type === 'message')
    return relay.db.prepare('SELECT content, status, policy_code, status_reason FROM relay_messages WHERE id = ?').bind(a.target_id).first();
  if (a.target_type === 'strike')
    return relay.db.prepare('SELECT policy_code, reason, created_by, created_at, expires_at FROM strikes WHERE id = ?').bind(a.target_id).first();
  return relay.db.prepare('SELECT status, status_reason, posting_paused_until FROM agents WHERE id = ?').bind(a.target_id).first();
}

const OVERTURNED_BLOCK = 'The block was overturned on appeal and no longer counts against you. Send the message again with the same Idempotency-Key.';

/** What overturning an appeal does. Every step is safe to repeat, so a decision that failed half way can be made again. */
async function undo(relay: Relay, adminId: string, appeal: AppealRow, response: string): Promise<void> {
  const by = { type: 'admin' as const, id: adminId };
  if (appeal.target_type === 'strike') {
    await removeStrike(relay, appeal.target_id, by, 'Appeal overturned');
    return;
  }
  if (appeal.target_type === 'message') {
    const { results: linked } = await relay.db
      .prepare("SELECT id FROM strikes WHERE agent_id = ? AND reason = policy_code || ' on ' || ?")
      .bind(appeal.agent_id, appeal.target_id)
      .all<{ id: string }>();
    for (const s of linked) await removeStrike(relay, s.id, by, 'Appeal overturned');
    const m = await getRow(relay, appeal.target_id);
    // An overturned block leaves the agent's record (#18): the message becomes `failed`, so it counts toward nothing, and the
    // agent may send it again with the same key. A hold someone overturns was only waiting, so it is sent.
    if (m?.status === 'blocked') {
      await relay.db
        .prepare(
          "UPDATE relay_messages SET status = 'failed', verdict = NULL, policy_code = NULL, status_reason = ?, reviewed_by = ?, updated_at = ? WHERE id = ? AND status = 'blocked'",
        )
        .bind(OVERTURNED_BLOCK, adminId, iso(relay.now()), m.id)
        .run();
    }
    if (m && m.content !== null && m.status === 'held' && m.held_kind !== 'reports') {
      const q = await relay.db
        .prepare(
          "UPDATE relay_messages SET status = 'queued', verdict = 'pass', policy_code = NULL, status_reason = 'Approved on appeal', held_kind = NULL, next_review_at = NULL, reviewed_by = ?, updated_at = ? WHERE id = ? AND status = 'held'",
        )
        .bind(adminId, iso(relay.now()), m.id)
        .run();
      if (q.meta.changes > 0) await dispatch(relay, m);
    }
    return;
  }
  // An appeal against a suspension that is overturned puts the agent back; a pause is simply lifted.
  if ((await getAgent(relay, appeal.target_id)).status === 'suspended') {
    // The strike that tipped it into suspension goes too; otherwise the next strike would ban it at once. A suspension an admin
    // made by hand (its audit entry carries no strike count) has no such strike, so nothing unrelated is removed.
    const byLadder = await relay.db
      .prepare(
        "SELECT 1 AS x FROM audit_log WHERE target_type = 'agent' AND target_id = ? AND action = 'agent.suspended' AND diff LIKE '%active_strikes%' AND id = (SELECT id FROM audit_log WHERE target_type = 'agent' AND target_id = ? AND action = 'agent.suspended' ORDER BY created_at DESC, id DESC LIMIT 1)",
      )
      .bind(appeal.target_id, appeal.target_id)
      .first();
    const latest = byLadder
      ? await relay.db
          .prepare('SELECT id FROM strikes WHERE agent_id = ? AND expires_at > ? ORDER BY created_at DESC LIMIT 1')
          .bind(appeal.target_id, iso(relay.now()))
          .first<{ id: string }>()
      : null;
    if (latest) await removeStrike(relay, latest.id, by, `Suspension overturned on appeal: ${response}`);
    await adminAct(relay, adminId, appeal.target_id, { action: 'reinstate', reason: response });
  }
  await relay.db
    .prepare(
      "UPDATE agents SET posting_paused_until = NULL, status_reason = CASE WHEN status = 'active' THEN NULL ELSE status_reason END, updated_at = ? WHERE id = ?",
    )
    .bind(iso(relay.now()), appeal.target_id)
    .run();
}

/**
 * Uphold keeps the decision. Overturn undoes it: the strike goes, the message is sent, or the pause is lifted.
 * The appeal is claimed first (so two admins can't decide it twice), then the effects run, and only then is the decision
 * audited and logged. If an effect throws, the claim is undone: the appeal is open again and the decision can be made again,
 * instead of standing as decided with nothing done.
 */
export async function decideAppeal(relay: Relay, adminId: string, appealId: string, body: AppealDecision): Promise<AdminAppeal> {
  const appeal = await relay.db
    .prepare('SELECT ap.*, a.name AS agent_name FROM appeals ap JOIN agents a ON a.id = ap.agent_id WHERE ap.id = ?')
    .bind(appealId)
    .first<AppealRow>();
  if (!appeal) throw notFound('No such appeal');
  const status = body.decision === 'uphold' ? 'upheld' : 'overturned';
  const r = await relay.db
    .prepare("UPDATE appeals SET status = ?, response = ?, resolved_by = ?, resolved_at = ? WHERE id = ? AND status = 'open'")
    .bind(status, body.response, adminId, iso(relay.now()), appealId)
    .run();
  if (r.meta.changes === 0) throw conflict(`This appeal was already ${appeal.status}.`);

  try {
    if (body.decision === 'overturn') await undo(relay, adminId, appeal, body.response);
  } catch (err) {
    await relay.db
      .prepare("UPDATE appeals SET status = 'open', response = NULL, resolved_by = NULL, resolved_at = NULL WHERE id = ? AND status = ? AND resolved_by = ?")
      .bind(appealId, status, adminId)
      .run()
      .catch((reopen) => relay.log.error('appeal.reopen_failed', { appeal_id: appealId, error: reopen }));
    throw err;
  }

  await relay.db.batch([
    auditStmt(relay, {
      ...admin(adminId),
      action: `appeal.${status}`,
      target_type: appeal.target_type,
      target_id: appeal.target_id,
      reason: body.response,
      diff: { status: { from: 'open', to: status } },
    }),
    ...(body.decision === 'overturn'
      ? [
          logStmt(relay, appeal.agent_id, appeal.target_type === 'message' ? appeal.target_id : null, {
            layer: 'review',
            verdict: 'pass',
            policy: null,
            reason: `Appeal overturned: ${body.response.slice(0, 200)}`,
            source: `admin:${adminId}`,
            latencyMs: null,
          }),
        ]
      : []),
  ]);
  const done = (await relay.db
    .prepare('SELECT ap.*, a.name AS agent_name FROM appeals ap JOIN agents a ON a.id = ap.agent_id WHERE ap.id = ?')
    .bind(appealId)
    .first<AppealRow>())!;
  return { ...done, subject: await appealSubject(relay, done) };
}

/* ---------- Stats ---------- */

export async function moderationStats(relay: Relay): Promise<ModerationStats> {
  const windows: ModerationStats['windows'] = [];
  for (const days of [1, 7, 30]) {
    const since = iso(new Date(relay.now().getTime() - days * 86_400_000));
    const { results } = await relay.db
      .prepare('SELECT layer, verdict, policy_code, COUNT(*) AS n FROM moderation_log WHERE created_at >= ? GROUP BY layer, verdict, policy_code')
      .bind(since)
      .all<{ layer: string; verdict: 'pass' | 'hold' | 'block'; policy_code: string | null; n: number }>();
    const w: ModerationStats['windows'][number] = { days, total: 0, by_layer: {}, by_verdict: { pass: 0, hold: 0, block: 0 }, by_policy: {} };
    for (const r of results) {
      w.total += r.n;
      const layer = (w.by_layer[r.layer] ??= { pass: 0, hold: 0, block: 0 });
      layer[r.verdict] += r.n;
      w.by_verdict[r.verdict] += r.n;
      if (r.policy_code) {
        const policy = (w.by_policy[r.policy_code] ??= { pass: 0, hold: 0, block: 0 });
        policy[r.verdict] += r.n;
      }
    }
    windows.push(w);
  }
  const held = await relay.db
    .prepare("SELECT COUNT(*) AS n, MIN(created_at) AS oldest FROM relay_messages WHERE status = 'held'")
    .first<{ n: number; oldest: string | null }>();
  return { windows, queue: { size: held?.n ?? 0, oldest_age_seconds: held?.oldest ? age(relay, held.oldest) : null } };
}
