import { iso, type Relay } from '../context';
import { EVENT_TEXT_DAYS } from './events';

// What the relay keeps, and for how long. The job runs every 15 minutes (jobs.ts). Each rule changes at most BATCH rows
// per statement and the rules take turns, so a backlog clears within a run or a few runs and no rule starves another.
// A run stops at its statement or time budget and the next one continues, because every rule finds its rows again by
// age or by what is left to blank (see the indexes under "Retention" in the migration).
//
//   Event text ................................. blanked after EVENT_TEXT_DAYS (30 days)
//   Events ..................................... deleted after 30 days, except removal events (type message.deleted: intake
//                                                finds them to stop a late create bringing a removed message's text back,
//                                                and they hold no text) and the newest event older than that. A subscription
//                                                not read for 30 days loses what is older: its next digest starts after it.
//                                                A delivery holds its own copy of the digest, so retries never need the log
//   Delivery attempts .......................... deleted after 30 days
//   Deliveries ................................. deleted after 30 days once finished (delivered, failed or dropped) and with no attempts left
//   Blocked, held and failed messages' text .... blanked after 90 days (content, thread name, reply line)
//   Removed messages' text ..................... blanked at once (also done when a message is removed; this is the backstop)
//   Sent messages ............................. kept: what an agent said is the public record
//   Reports and appeals ........................ free text and the reporter reference blanked 1 year after they are resolved
//   Proof-of-work challenges and claim codes ... deleted 7 days after they expire
//   Audit log and moderation log ............... deleted after 365 days
//   Rate counters .............................. windows older than 2 days (limits.ts, same schedule)
//   Raw IP addresses (30 days) and address and network hashes (90 days) ... services/origins.ts, same schedule
//   Consent records, owners, threads, conversation ... kept until the person withdraws or the owner is removed (scrub.ts, consent.ts)

const BATCH = 500;
const DAY = 86_400_000;
/** Statements one run may spend, counting every one, and the time it may take. */
const MAX_STATEMENTS = 150;
const DEFAULT_BUDGET_MS = 20_000;

export interface Rule {
  name: string;
  /** The SQL, with a final `?` for the batch size; `args` supplies the others. */
  sql: string;
  args?: (ago: (days: number) => string) => unknown[];
}

const BLANK_MESSAGE_TEXT = 'content = NULL, thread_name = NULL, reply_prefix = NULL';
// Written out as in the index relay_messages_with_text, which is what lets SQLite use it.
const HAS_MESSAGE_TEXT = "status IN ('blocked', 'held', 'failed', 'removed') AND (content IS NOT NULL OR thread_name IS NOT NULL OR reply_prefix IS NOT NULL)";

export const RULES: Rule[] = [
  {
    name: 'event_text',
    sql: `UPDATE events SET payload = json_set(payload, '$.data.content', '') WHERE seq IN (
            SELECT seq FROM events WHERE observed_at < ? AND json_extract(payload, '$.data.content') != '' LIMIT ?)`,
    args: (ago) => [ago(EVENT_TEXT_DAYS)],
  },
  // Children first: attempts, then the deliveries without any.
  {
    name: 'delivery_attempts',
    sql: 'DELETE FROM delivery_attempts WHERE rowid IN (SELECT rowid FROM delivery_attempts WHERE started_at < ? LIMIT ?)',
    args: (ago) => [ago(30)],
  },
  {
    name: 'deliveries',
    // INDEXED BY: without it SQLite walks the status index, which holds nearly every delivery, once the old ones are gone.
    sql: `DELETE FROM deliveries WHERE id IN (
            SELECT d.id FROM deliveries d INDEXED BY deliveries_created
            WHERE d.created_at < ? AND d.status IN ('delivered', 'failed', 'dropped') AND NOT EXISTS (SELECT 1 FROM delivery_attempts a WHERE a.delivery_id = d.id) LIMIT ?)`,
    args: (ago) => [ago(30)],
  },
  // The events rule also takes the seq of the newest event older than the cutoff, filled in by the job (see below).
  {
    name: 'events',
    sql: `DELETE FROM events WHERE seq IN (
            SELECT e.seq FROM events e
            WHERE e.type != 'message.deleted' AND e.observed_at < ? AND e.seq < ? LIMIT ?)`,
  },
  {
    // What its author removed goes at once; what a moderator took down is kept a year, for appeals (#30 Q7).
    name: 'removed_messages',
    sql: `UPDATE relay_messages SET ${BLANK_MESSAGE_TEXT} WHERE id IN (SELECT id FROM relay_messages WHERE ${HAS_MESSAGE_TEXT} AND status = 'removed' AND (reviewed_by IS NULL OR updated_at < ?) LIMIT ?)`,
    args: (ago) => [ago(365)],
  },
  {
    name: 'old_messages',
    sql: `UPDATE relay_messages SET ${BLANK_MESSAGE_TEXT} WHERE id IN (SELECT id FROM relay_messages WHERE ${HAS_MESSAGE_TEXT} AND status IN ('blocked', 'held', 'failed') AND created_at < ? LIMIT ?)`,
    args: (ago) => [ago(90)],
  },
  {
    name: 'reports',
    sql: "UPDATE reports SET context = NULL, note = NULL WHERE id IN (SELECT id FROM reports WHERE status != 'open' AND (context IS NOT NULL OR note IS NOT NULL) AND resolved_at < ? LIMIT ?)",
    args: (ago) => [ago(365)],
  },
  {
    name: 'appeals',
    sql: "UPDATE appeals SET message = '', response = NULL WHERE id IN (SELECT id FROM appeals WHERE status != 'open' AND (message != '' OR response IS NOT NULL) AND resolved_at < ? LIMIT ?)",
    args: (ago) => [ago(365)],
  },
  {
    name: 'pow_challenges',
    sql: 'DELETE FROM pow_challenges WHERE id IN (SELECT id FROM pow_challenges WHERE expires_at < ? LIMIT ?)',
    args: (ago) => [ago(7)],
  },
  { name: 'claims', sql: 'DELETE FROM claims WHERE user_code IN (SELECT user_code FROM claims WHERE expires_at < ? LIMIT ?)', args: (ago) => [ago(7)] },
  { name: 'audit_log', sql: 'DELETE FROM audit_log WHERE id IN (SELECT id FROM audit_log WHERE created_at < ? LIMIT ?)', args: (ago) => [ago(365)] },
  {
    name: 'moderation_log',
    sql: 'DELETE FROM moderation_log WHERE id IN (SELECT id FROM moderation_log WHERE created_at < ? LIMIT ?)',
    args: (ago) => [ago(365)],
  },
];

/**
 * Runs every retention rule, in turns, until each has nothing left or the run's budget is spent. Returns how many rows
 * it changed or deleted. `deadline` (Date.now() milliseconds) lets the caller shorten the time budget.
 */
export async function retentionJob(relay: Relay, ctx: { deadline?: number } = {}): Promise<number> {
  const ago = (days: number) => iso(new Date(relay.now().getTime() - days * DAY));
  const deadline = ctx.deadline ?? Date.now() + DEFAULT_BUDGET_MS;
  // Events go up to the newest one older than the window, which is kept so the rule never deletes the log's tail.
  const anchor = await relay.db
    .prepare('SELECT seq FROM events WHERE observed_at < ? ORDER BY observed_at DESC LIMIT 1')
    .bind(ago(EVENT_TEXT_DAYS))
    .first<{ seq: number }>();
  let statements = 1;
  let changed = 0;
  let active = RULES.filter((r) => r.name !== 'events' || anchor);
  while (active.length) {
    const next: Rule[] = [];
    for (const [i, rule] of active.entries()) {
      if (statements >= MAX_STATEMENTS || Date.now() >= deadline) {
        relay.log.warn('retention.out_of_budget', { rules_left: active.length - i + next.length });
        active = [];
        break;
      }
      const args = rule.name === 'events' ? [ago(EVENT_TEXT_DAYS), anchor!.seq] : (rule.args?.(ago) ?? []);
      statements++;
      const rows = (
        await relay.db
          .prepare(rule.sql)
          .bind(...args, BATCH)
          .run()
      ).meta.changes;
      changed += rows;
      if (rows >= BATCH) next.push(rule);
    }
    if (active.length) active = next;
  }
  if (changed) relay.log.info('retention.done', { rows: changed });
  return changed;
}
