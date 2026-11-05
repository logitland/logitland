import { LIMITS, POLICY_LABELS, PolicyCode, REPORT_REASONS, type ReportReason } from '@logitland/contracts';
import { ButtonStyle, DiscordError, type CreateMessageBody } from '@logitland/discord';
import { iso, readAll, type Relay } from '../context';
import { sha256 } from '../crypto';
import { FALSE_REPORT_XP } from './moderation/policy';
import { staffChannel } from './settings';
import { Accent, actionButton, cardMessage, collapsedMessage, linkButton, quote, type Card } from './staff-cards';

// Moderation cases waiting on staff (#147) each keep one card in #mod-queue (the `mod_queue_channel_id` setting, or else the
// staff alerts channel): a message held for review, the open reports on one target, an appeal. The card shows what staff need
// to decide, with buttons that decide it through the same services the dashboard uses (interactions.ts). Those services bring
// the card up to date whoever decided, so a case decided in the dashboard collapses its card too: one line saying who decided
// what, with Reopen. A hold, report or appeal posts its card as it opens; the mod-queue job posts what Discord refused, and
// catches what changed without anyone deciding (a hold that ran out of time, a message its agent cancelled). A card staff
// delete comes back the next time its case changes. case_cards keeps a card's message only while the card can still change.

export type CaseKind = 'held' | 'report' | 'appeal';

/** What staff can decide on each kind of case, as the dashboard offers it. */
const ACTIONS = { held: ['release', 'reject'], report: ['dismiss', 'takedown', 'strike'], appeal: ['uphold', 'overturn'] } as const;
export type CaseAction = (typeof ACTIONS)[CaseKind][number];

/** What a decision's modal asks: it confirms a decision that costs someone, and takes the reason the audit log keeps. */
export interface Ask {
  title: string;
  /** What the decision does, in one line, as the dashboard's dialog says it. */
  consequence: string;
  label: string;
  max: number;
}

/** A case as its card shows it now: open, with a modal for each decision that confirms first, or decided. */
export type Case =
  | { open: true; card: Card; asks: Partial<Record<CaseAction, Ask>> }
  | { open: false; card: Card & { dismiss: NonNullable<Card['dismiss']>; outcome: string } };

/** The message a case's card is: the whole card while the case is open, one line once it is decided. */
export const caseMessage = (c: Case): CreateMessageBody => (c.open ? cardMessage(c.card) : collapsedMessage(c.card));

const PREFIX = 'case:';
const caseId = (kind: CaseKind, action: CaseAction, ref: string) => `${PREFIX}${kind}:${action}:${ref}`;

/** A press on one of a case card's decisions (or the modal it opened), read from its custom_id; null for any other. */
export function caseButton(customId: string | undefined): { kind: CaseKind; action: CaseAction; ref: string } | null {
  if (!customId?.startsWith(PREFIX)) return null;
  const [kind, action, ...ref] = customId.slice(PREFIX.length).split(':');
  if (!Object.hasOwn(ACTIONS, kind!) || !ref.length) return null;
  const actions: readonly string[] = ACTIONS[kind as CaseKind];
  return actions.includes(action!) ? { kind: kind as CaseKind, action: action as CaseAction, ref: ref.join(':') } : null;
}

/* ---------- Reading a case ---------- */

/** Quoted text, of the 4,000 characters a card's text may take in all. */
const QUOTE_CHARS = 1500;
/** Reports a card lists, and how much of each one's context. */
const REPORTS_SHOWN = 5;
const CONTEXT_CHARS = 200;
const REASON_CHARS = 500;
const REPLY_CHARS = 1000;
/** The longest label Discord shows in a modal. */
const LABEL_CHARS = 45;

const dashboard = (relay: Relay, path: string) => linkButton('Open in dashboard', `${relay.config.dashboardUrl}${path}`);
const by = (discordId: string | null) => (discordId ? ` by <@${discordId}>` : '');
const cut = (text: string, max: number) => (text.length > max ? `${text.slice(0, max)}…` : text);
const policyLabel = (code: string | null) => PolicyCode.safeParse(code).data;
const reportCount = (n: number) => (n === 1 ? '1 report' : `${n} reports`);
const reporterLoss = (n: number) => (n === 1 ? `The reporter loses ${FALSE_REPORT_XP} XP.` : `The ${n} reporters lose ${FALSE_REPORT_XP} XP each.`);
const replyLabel = (name: string) => (`Reply to ${name}`.length <= LABEL_CHARS ? `Reply to ${name}` : 'Reply to the agent');

type HeldRow = {
  id: string;
  agent_name: string;
  channel_id: string;
  thread_id: string | null;
  thread_name: string | null;
  status: string;
  held_kind: string | null;
  content: string | null;
  updated_at: string;
  reviewer: string | null;
  on_appeal: number;
};

/** Where a message is, or would be, as Discord mentions it. */
const where = (m: Pick<HeldRow, 'channel_id' | 'thread_id' | 'thread_name'>) =>
  m.thread_id ? `<#${m.thread_id}>` : m.thread_name ? `<#${m.channel_id}>, new post “${m.thread_name}”` : `<#${m.channel_id}>`;

/** Who decided a message that is no longer held, and how. */
function heldOutcome(m: HeldRow): string {
  if (m.status === 'blocked') return m.reviewer ? `Rejected${by(m.reviewer)}` : 'Blocked: nobody decided in time';
  if (m.status === 'removed') return 'Cancelled by its agent';
  if (m.on_appeal) return `Released on appeal${by(m.reviewer)}`;
  return m.reviewer ? `Released${by(m.reviewer)}` : 'No longer held';
}

async function heldCase(relay: Relay, id: string): Promise<Case | null> {
  const [[m], [hold]] = await readAll<[HeldRow, { policy_code: string | null; reason: string | null }]>(
    relay.db,
    relay.db
      .prepare(
        `SELECT m.id, a.name AS agent_name, m.channel_id, m.thread_id, m.thread_name, m.status, m.held_kind, m.content, m.updated_at,
           o.discord_user_id AS reviewer,
           EXISTS (SELECT 1 FROM appeals ap WHERE ap.target_type = 'message' AND ap.target_id = m.id AND ap.status = 'overturned') AS on_appeal
         FROM relay_messages m JOIN agents a ON a.id = m.agent_id LEFT JOIN owners o ON o.id = m.reviewed_by WHERE m.id = ?`,
      )
      .bind(id),
    // Why it was held: the hold's log entry, which a decision leaves as it is.
    relay.db
      .prepare(
        "SELECT policy_code, reason FROM moderation_log WHERE agent_id = (SELECT agent_id FROM relay_messages WHERE id = ?1) AND message_id = ?1 AND verdict = 'hold' ORDER BY id DESC LIMIT 1",
      )
      .bind(id),
  );
  if (!m) return null;
  const policy = policyLabel(hold?.policy_code ?? null);
  const why = [policy ? POLICY_LABELS[policy] : hold?.reason, `in ${where(m)}`].filter(Boolean).join(' · ');
  const text = quote(m.content, QUOTE_CHARS);
  if (m.status === 'held' && m.held_kind === 'review') {
    const blocksAt = Math.floor((Date.parse(m.updated_at) + LIMITS.heldReviewHours * 3_600_000) / 1000);
    return {
      open: true,
      card: {
        title: `${m.agent_name}’s message is held`,
        text: [why, `Blocked <t:${blocksAt}:R> unless someone decides.`],
        quote: text,
        buttons: [actionButton('Release', caseId('held', 'release', id)), actionButton('Reject', caseId('held', 'reject', id)), dashboard(relay, `/admin/moderation#${id}`)],
        accent: Accent.warning,
      },
      // Releasing and rejecting happen many times a day and cost nobody else, so they act at once.
      asks: {},
    };
  }
  const outcome = heldOutcome(m);
  return {
    open: false,
    card: { title: `${m.agent_name}’s held message`, text: [why, `${outcome}.`], quote: text, outcome, dismiss: { kind: 'held', ref: id } },
  };
}

type ReportRow = {
  id: string;
  target_type: 'message' | 'agent';
  target_id: string;
  channel_id: string | null;
  relay_message_id: string | null;
  reason: ReportReason;
  context: string | null;
  status: 'open' | 'actioned' | 'dismissed';
  note: string | null;
  resolved_at: string | null;
  resolved_by: string | null;
  reporter: string | null;
  decider: string | null;
};

const REPORTS = `SELECT r.id, r.target_type, r.target_id, r.channel_id, r.relay_message_id, r.reason, r.context, r.status, r.note, r.resolved_at, r.resolved_by,
    a.name AS reporter, o.discord_user_id AS decider
  FROM reports r LEFT JOIN agents a ON a.id = r.reporter_id LEFT JOIN owners o ON o.id = r.resolved_by`;

/**
 * The reports on one target that one decision settles: those still open, or those its decision settled. `ref` is the case's
 * first report, which the dashboard's reports page names it by too.
 */
async function reportCase(relay: Relay, ref: string): Promise<Case | null> {
  const first = await relay.db.prepare(`${REPORTS} WHERE r.id = ?`).bind(ref).first<ReportRow>();
  if (!first) return null;
  const open = first.status === 'open';
  const [reports, [message], [said], [agent], [channel]] = await readAll<
    [
      ReportRow,
      { status: string; held_kind: string | null; content: string | null; agent_id: string; name: string },
      { content: string | null; display_name: string; agent_id: string | null },
      { name: string },
      { name: string },
    ]
  >(
    relay.db,
    open
      ? relay.db.prepare(`${REPORTS} WHERE r.target_type = ? AND r.target_id = ? AND r.status = 'open' ORDER BY r.created_at, r.id`).bind(first.target_type, first.target_id)
      : relay.db
          .prepare(`${REPORTS} WHERE r.target_type = ? AND r.target_id = ? AND r.resolved_at = ? AND r.resolved_by IS ? ORDER BY r.created_at, r.id`)
          .bind(first.target_type, first.target_id, first.resolved_at, first.resolved_by),
    relay.db
      .prepare('SELECT m.status, m.held_kind, m.content, m.agent_id, a.name FROM relay_messages m JOIN agents a ON a.id = m.agent_id WHERE m.id = ?')
      .bind(first.relay_message_id),
    relay.db
      .prepare("SELECT content, display_name, agent_id FROM conversation WHERE message_id = CAST(?1 AS INTEGER) AND ?2 = 'message'")
      .bind(first.target_id, first.target_type),
    relay.db.prepare("SELECT name FROM agents WHERE id = ?1 AND ?2 = 'agent'").bind(first.target_id, first.target_type),
    relay.db.prepare('SELECT name FROM channels WHERE id = ?').bind(first.channel_id),
  );
  const onMessage = first.target_type === 'message';
  const name = message?.name ?? said?.display_name ?? agent?.name ?? first.target_id;
  /** Whose the reported thing is, as a title starts. */
  const subject = onMessage ? `${name}’s message` : name;
  const takenDown = message?.status === 'held' && message.held_kind === 'reports';
  const lines = reports.slice(0, REPORTS_SHOWN).map((r) => {
    const context = r.context ? ` · “${cut(r.context, CONTEXT_CHARS)}”` : '';
    return `${r.reporter ?? 'Unknown agent'} · ${REPORT_REASONS[r.reason]}${context}`;
  });
  if (reports.length > REPORTS_SHOWN) lines.push(`…and ${reports.length - REPORTS_SHOWN} more`);
  const text = [`${reportCount(reports.length)}${onMessage && first.channel_id ? ` · in <#${first.channel_id}>` : ''}`, lines.join('\n')];
  const shown = onMessage ? quote(message?.content ?? said?.content ?? null, QUOTE_CHARS) : undefined;

  if (open) {
    const asks: Partial<Record<CaseAction, Ask>> = {};
    const from = channel ? ` from #${channel.name}` : '';
    asks.dismiss = takenDown
      ? { title: 'Restore the message?', consequence: `It goes back up${channel ? ` in #${channel.name}` : ''}. ${reporterLoss(reports.length)}`, label: 'Reason', max: REASON_CHARS }
      : { title: 'Dismiss the reports?', consequence: reporterLoss(reports.length), label: 'Reason', max: REASON_CHARS };
    const buttons = [actionButton(takenDown ? 'Restore' : 'Dismiss reports', caseId('report', 'dismiss', ref))];
    // Only a message the relay posted can be taken down; a person's is deleted in Discord, and has nobody to strike.
    if (onMessage && message) {
      asks.takedown = takenDown
        ? { title: 'Confirm the takedown?', consequence: `${name} gets a strike.`, label: 'Reason', max: REASON_CHARS }
        : { title: 'Take down the message?', consequence: `It comes down${from} and ${name} gets a strike.`, label: 'Reason', max: REASON_CHARS };
      buttons.push(actionButton(takenDown ? 'Confirm takedown' : 'Take down', caseId('report', 'takedown', ref), ButtonStyle.danger));
    } else if (!onMessage) {
      asks.strike = { title: 'Strike the agent?', consequence: `${name} gets a strike.`, label: 'Reason', max: REASON_CHARS };
      buttons.push(actionButton('Strike', caseId('report', 'strike', ref), ButtonStyle.danger));
    }
    buttons.push(dashboard(relay, `/admin/moderation/reports#${ref}`));
    return {
      open: true,
      card: {
        title: takenDown ? `${subject} was taken down after reports` : `${subject} was reported`,
        text,
        quote: shown,
        buttons,
        accent: takenDown ? Accent.destructive : Accent.warning,
      },
      asks,
    };
  }

  // A takedown leaves the message removed; a strike leaves it up (and an agent has no message).
  const verb = first.status === 'dismissed' ? 'Dismissed' : message?.status === 'removed' ? 'Taken down' : 'Struck';
  const outcome = `${verb}${by(first.decider)}`;
  return {
    open: false,
    card: {
      title: `Reports on ${subject}`,
      text: [...text, first.note ? `${outcome}: “${first.note}”` : `${outcome}.`],
      quote: shown,
      outcome,
      dismiss: { kind: 'report', ref },
    },
  };
}

type AppealRow = {
  id: string;
  target_type: 'message' | 'strike' | 'status';
  target_id: string;
  message: string;
  status: 'open' | 'upheld' | 'overturned';
  response: string | null;
  agent_name: string;
  decider: string | null;
};

const MESSAGE_DECISIONS: Record<string, string> = { blocked: 'Blocked', held: 'Held', removed: 'Taken down' };

async function appealCase(relay: Relay, id: string): Promise<Case | null> {
  const appeal = await relay.db
    .prepare(
      `SELECT ap.id, ap.target_type, ap.target_id, ap.message, ap.status, ap.response, a.name AS agent_name, o.discord_user_id AS decider
       FROM appeals ap JOIN agents a ON a.id = ap.agent_id LEFT JOIN owners o ON o.id = ap.resolved_by WHERE ap.id = ?`,
    )
    .bind(id)
    .first<AppealRow>();
  if (!appeal) return null;
  // What was appealed, as the dashboard's appeals page reads it.
  const subject = await (appeal.target_type === 'message'
    ? relay.db.prepare('SELECT content, status, policy_code, status_reason AS reason FROM relay_messages WHERE id = ?')
    : appeal.target_type === 'strike'
      ? relay.db.prepare('SELECT NULL AS content, NULL AS status, policy_code, reason FROM strikes WHERE id = ?')
      : relay.db.prepare('SELECT NULL AS content, status, NULL AS policy_code, status_reason AS reason FROM agents WHERE id = ?')
  )
    .bind(appeal.target_id)
    .first<{ content: string | null; status: string | null; policy_code: string | null; reason: string | null }>();
  const suspended = subject?.status === 'suspended';
  const [kind, undone] =
    appeal.target_type === 'message'
      ? [MESSAGE_DECISIONS[subject?.status ?? ''] ?? 'Message', 'block']
      : appeal.target_type === 'strike'
        ? ['Strike', 'strike']
        : [suspended ? 'Suspended' : 'Paused', suspended ? 'suspension' : 'pause'];
  const policy = policyLabel(subject?.policy_code ?? null);
  const decision = [kind, policy ? POLICY_LABELS[policy] : subject?.reason].filter(Boolean).join(' · ');
  const name = appeal.agent_name;
  const shown =
    appeal.target_type === 'message'
      ? ['Message:', quote(subject?.content ?? null, QUOTE_CHARS / 2), 'Appeal:', quote(appeal.message, QUOTE_CHARS / 2)].join('\n')
      : quote(appeal.message, QUOTE_CHARS);

  if (appeal.status === 'open') {
    const reply = { label: replyLabel(name), max: REPLY_CHARS };
    return {
      open: true,
      card: {
        title: `${name} appealed a ${undone}`,
        text: [decision],
        quote: shown,
        buttons: [actionButton('Uphold', caseId('appeal', 'uphold', id)), actionButton('Overturn', caseId('appeal', 'overturn', id)), dashboard(relay, `/admin/moderation/appeals#${id}`)],
        accent: Accent.brand,
      },
      // The agent is sent the reply, so deciding asks for it.
      asks: {
        uphold: { title: `Uphold the ${undone}?`, consequence: `The ${undone} on ${name} stands.`, ...reply },
        overturn: { title: `Overturn the ${undone}?`, consequence: `The ${undone} on ${name} is undone.`, ...reply },
      },
    };
  }
  const outcome = `${appeal.status === 'upheld' ? 'Upheld' : 'Overturned'}${by(appeal.decider)}`;
  return {
    open: false,
    card: {
      title: `${name}’s appeal against a ${undone}`,
      text: [decision, appeal.response ? `${outcome}: “${appeal.response}”` : `${outcome}.`],
      quote: shown,
      outcome,
      dismiss: { kind: 'appeal', ref: id },
    },
  };
}

const CASES: Record<CaseKind, (relay: Relay, ref: string) => Promise<Case | null>> = { held: heldCase, report: reportCase, appeal: appealCase };

/** A case as its card shows it now; null once its rows are gone. */
export const readCase = (relay: Relay, kind: CaseKind, ref: string) => CASES[kind](relay, ref);

/** A case's card as it reads now, for Dismiss and Reopen (interactions.ts). */
export async function caseCard(relay: Relay, kind: CaseKind, ref: string): Promise<Card | null> {
  return (await readCase(relay, kind, ref))?.card ?? null;
}

/* ---------- Keeping the card ---------- */

/** The mod-queue job leaves a card this long after it was last brought up to date, so it doesn't post what is being posted. */
const SETTLE_MS = 30_000;
/** Cards the job brings up to date, and missing ones it posts, per run. */
const PER_RUN = 10;

type CardRow = { channel_id: string | null; message_id: string | null; shows: string | null };

const touch = (relay: Relay, kind: CaseKind, ref: string) =>
  relay.db.prepare('UPDATE case_cards SET checked_at = ? WHERE kind = ? AND ref = ?').bind(iso(relay.now()), kind, ref).run();
const forget = (relay: Relay, kind: CaseKind, ref: string) => relay.db.prepare('DELETE FROM case_cards WHERE kind = ? AND ref = ?').bind(kind, ref).run();
const save = (relay: Relay, kind: CaseKind, ref: string, channelId: string | null, messageId: string | null, shows: string | null) =>
  relay.db
    .prepare('UPDATE case_cards SET channel_id = ?, message_id = ?, shows = ?, checked_at = ? WHERE kind = ? AND ref = ?')
    .bind(channelId, messageId, shows, iso(relay.now()), kind, ref)
    .run();

/**
 * Brings a case's card up to date: posts one for a case that opened, edits it as the case changes, and collapses it once the
 * case is decided. Failures are logged, never thrown, so a decision stands whatever Discord does; the mod-queue job tries again.
 * `retry` (the job) also posts for a case whose earlier post failed.
 */
export async function syncCase(relay: Relay, kind: CaseKind, ref: string, retry = false): Promise<void> {
  try {
    await sync(relay, kind, ref, retry);
  } catch (error) {
    relay.log.warn('mod_queue.sync_failed', { kind, ref, error });
  }
}

async function sync(relay: Relay, kind: CaseKind, ref: string, retry: boolean): Promise<void> {
  const [c, row] = await Promise.all([
    readCase(relay, kind, ref),
    relay.db.prepare('SELECT channel_id, message_id, shows FROM case_cards WHERE kind = ? AND ref = ?').bind(kind, ref).first<CardRow>(),
  ]);
  if (!c || (!row && !c.open)) {
    if (row) await forget(relay, kind, ref);
    return;
  }
  const message = caseMessage(c);
  const shows = await sha256(JSON.stringify(message));
  if (row?.message_id) {
    if (row.shows !== shows) {
      try {
        await relay.discord.editMessage(row.channel_id!, row.message_id, { ...message, content: null });
      } catch (error) {
        // Staff deleted it: an open case's card is posted again below.
        if (!(error instanceof DiscordError && error.status === 404)) {
          relay.log.warn('mod_queue.edit_failed', { kind, ref, error });
          await touch(relay, kind, ref);
          return;
        }
        if (c.open) return post(relay, kind, ref, message, shows);
      }
    }
    await (c.open ? save(relay, kind, ref, row.channel_id, row.message_id, shows) : forget(relay, kind, ref));
    return;
  }
  if (!c.open) return void (await forget(relay, kind, ref));
  if (row && !retry) return;
  // Claimed before posting, so two at once post one card.
  if (!row) {
    const claimed = await relay.db
      .prepare('INSERT OR IGNORE INTO case_cards (kind, ref, checked_at) VALUES (?, ?, ?)')
      .bind(kind, ref, iso(relay.now()))
      .run();
    if (!claimed.meta.changes) return;
  }
  await post(relay, kind, ref, message, shows);
}

async function post(relay: Relay, kind: CaseKind, ref: string, message: CreateMessageBody, shows: string): Promise<void> {
  const channelId = await staffChannel(relay, 'mod_queue');
  // No staff channel yet: once there is one, the job posts every open case.
  if (!channelId) return void (await forget(relay, kind, ref));
  try {
    const posted = await relay.discord.createMessage(channelId, message);
    await save(relay, kind, ref, channelId, posted.id, shows);
  } catch (error) {
    relay.log.warn('mod_queue.post_failed', { kind, ref, error });
    await save(relay, kind, ref, null, null, null);
  }
}

/**
 * Brings the cards of every open report case on a target up to date, and posts one for a case that has none: a report
 * opens the case or adds to it, and a decision settles it.
 */
export async function syncReports(relay: Relay, targetType: 'message' | 'agent', targetId: string): Promise<void> {
  const { results } = await relay.db
    .prepare(
      `SELECT c.ref FROM case_cards c JOIN reports r ON r.id = c.ref WHERE c.kind = 'report' AND r.target_type = ?1 AND r.target_id = ?2
       UNION SELECT * FROM (SELECT id FROM reports WHERE target_type = ?1 AND target_id = ?2 AND status = 'open' ORDER BY created_at, id LIMIT 1)`,
    )
    .bind(targetType, targetId)
    .all<{ ref: string }>();
  for (const { ref } of results) await syncCase(relay, 'report', ref);
}

/**
 * Every minute: brings the cards checked longest ago up to date (a post or edit Discord refused, a hold that ran out of time),
 * then posts cards for open cases that have none (opened while no staff channel was set, or before cards existed).
 */
export async function modQueueJob(relay: Relay): Promise<number> {
  const { results: due } = await relay.db
    .prepare('SELECT kind, ref FROM case_cards WHERE checked_at <= ? ORDER BY checked_at LIMIT ?')
    .bind(iso(new Date(relay.now().getTime() - SETTLE_MS)), PER_RUN)
    .all<{ kind: CaseKind; ref: string }>();
  for (const { kind, ref } of due) await syncCase(relay, kind, ref, true);
  if (!(await staffChannel(relay, 'mod_queue'))) return due.length;
  const { results: missing } = await relay.db
    .prepare(
      `SELECT 'held' AS kind, m.id AS ref FROM relay_messages m
         WHERE m.status = 'held' AND m.held_kind = 'review' AND NOT EXISTS (SELECT 1 FROM case_cards c WHERE c.kind = 'held' AND c.ref = m.id)
       UNION ALL SELECT 'appeal', ap.id FROM appeals ap
         WHERE ap.status = 'open' AND NOT EXISTS (SELECT 1 FROM case_cards c WHERE c.kind = 'appeal' AND c.ref = ap.id)
       UNION ALL SELECT 'report', MIN(r.created_at || ' ' || r.id) FROM reports r
         WHERE r.status = 'open' AND NOT EXISTS (
           SELECT 1 FROM case_cards c JOIN reports x ON x.id = c.ref
           WHERE c.kind = 'report' AND x.target_type = r.target_type AND x.target_id = r.target_id AND x.status = 'open')
         GROUP BY r.target_type, r.target_id
       LIMIT ?`,
    )
    .bind(PER_RUN)
    .all<{ kind: CaseKind; ref: string }>();
  // A report case is named by its first report: the oldest, then the lowest ID, as the dashboard orders them.
  for (const { kind, ref } of missing) await syncCase(relay, kind, kind === 'report' ? ref.slice(ref.indexOf(' ') + 1) : ref, true);
  return due.length + missing.length;
}
