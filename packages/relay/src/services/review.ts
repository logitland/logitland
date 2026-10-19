import { LIMITS } from '@logitland/contracts';
import { iso, type Relay } from '../context';
import { getAgent } from './identity';
import { logStmt, writeLog } from './moderation/log';
import { decide, settle } from './moderation/pipeline';
import { OUTAGE_BACKOFF_MINUTES, isOnProbation } from './moderation/policy';
import { getRow } from './moderation/rows';
import { dispatch } from './sending';
import { getSettings } from './settings';

// The held-message queue. Two kinds of hold: an outage (nothing could classify the message, so it is re-checked
// on a growing delay) and a review (a person decides). Reviews that nobody gets to expire into a block.

const MINUTE = 60_000;
const BATCH = 20;
/** Reviewer holds that expire in one run; the rest go on the next. */
const EXPIRE_BATCH = 100;
/**
 * One run stops starting new re-checks after this long (real time). Each re-check can wait on two classifiers for several
 * seconds, so during an outage a full batch would otherwise hold up the jobs after it; what is left is due again next minute.
 */
export const RECHECK_BUDGET_MS = 20_000;
/** While one run re-checks a message, the next run leaves it alone for this long. */
const LEASE_MS = 2 * MINUTE;

const STILL_UNAVAILABLE = 'Moderation stayed unavailable; send it again later.';
const NOT_REVIEWED = `Not reviewed within ${LIMITS.heldReviewHours} hours`;

async function recheck(relay: Relay, id: string, dueAt: string): Promise<boolean> {
  const lease = iso(new Date(relay.now().getTime() + LEASE_MS));
  const claimed = await relay.db
    .prepare("UPDATE relay_messages SET next_review_at = ? WHERE id = ? AND status = 'held' AND held_kind = 'outage' AND next_review_at = ?")
    .bind(lease, id, dueAt)
    .run();
  if (claimed.meta.changes !== 1) return false;

  const row = (await getRow(relay, id))!;
  const agent = await getAgent(relay, row.agent_id);
  const settings = await getSettings(relay);
  const d = await decide(relay, row, agent, { probation: isOnProbation(agent, settings, relay.now()) });

  if (d.kind === 'unavailable') {
    const attempts = row.review_attempts + 1;
    const at = iso(relay.now());
    if (attempts >= LIMITS.outageRecheckAttempts) {
      const r = await relay.db
        .prepare(
          "UPDATE relay_messages SET status = 'failed', verdict = NULL, policy_code = 'outage', status_reason = ?, held_kind = NULL, review_attempts = ?, next_review_at = NULL, updated_at = ? WHERE id = ? AND status = 'held' AND held_kind = 'outage'",
        )
        .bind(STILL_UNAVAILABLE, attempts, at, id)
        .run();
      if (r.meta.changes === 1)
        await writeLog(relay, agent.id, id, [
          { layer: 'review', verdict: 'block', policy: 'outage', reason: `${STILL_UNAVAILABLE} (${d.reason})`, source: d.source, latencyMs: d.latencyMs },
        ]);
      return true;
    }
    const wait = OUTAGE_BACKOFF_MINUTES[Math.min(attempts - 1, OUTAGE_BACKOFF_MINUTES.length - 1)]!;
    await relay.db
      .prepare("UPDATE relay_messages SET review_attempts = ?, next_review_at = ?, updated_at = ? WHERE id = ? AND status = 'held' AND held_kind = 'outage'")
      .bind(attempts, iso(new Date(relay.now().getTime() + wait * MINUTE)), at, id)
      .run();
    return true;
  }

  if ((await settle(relay, row, agent, d, 'outage')) && d.kind === 'pass') await dispatch(relay, row);
  return true;
}

/** Cron: re-check outage holds that are due, and expire reviewer holds nobody got to. */
export async function reviewHeldJob(relay: Relay, budgetMs: number = RECHECK_BUDGET_MS): Promise<number> {
  const now = relay.now();
  const started = Date.now();
  let handled = 0;
  let spent = false;
  // Batch after batch until nothing is due or the time is up: a backlog after an outage drains at the classifier's pace, not 20 a minute.
  // A re-check moves its row's due time on (or ends it), so a row never comes back in the same run.
  while (!spent) {
    const { results: due } = await relay.db
      .prepare(
        "SELECT id, next_review_at FROM relay_messages WHERE status = 'held' AND held_kind = 'outage' AND next_review_at <= ? ORDER BY next_review_at LIMIT ?",
      )
      .bind(iso(now), BATCH)
      .all<{ id: string; next_review_at: string }>();
    if (!due.length) break;
    let claimed = 0;
    for (const m of due) {
      if (Date.now() - started >= budgetMs) {
        relay.log.warn('review.budget_spent', { rechecked: handled, left: due.length - claimed });
        spent = true;
        break;
      }
      if (await recheck(relay, m.id, m.next_review_at)) {
        handled++;
        claimed++;
      }
    }
    if (!claimed) break;
  }

  const cutoff = iso(new Date(now.getTime() - LIMITS.heldReviewHours * 60 * MINUTE));
  const { results: expired } = await relay.db
    .prepare(
      "UPDATE relay_messages SET status = 'blocked', verdict = 'block', policy_code = 'manual', status_reason = ?, held_kind = NULL, updated_at = ? WHERE id IN (SELECT id FROM relay_messages WHERE status = 'held' AND held_kind = 'review' AND updated_at < ? ORDER BY updated_at LIMIT ?) AND status = 'held' AND held_kind = 'review' RETURNING id, agent_id",
    )
    .bind(NOT_REVIEWED, iso(now), cutoff, EXPIRE_BATCH)
    .all<{ id: string; agent_id: string }>();
  if (expired.length)
    await relay.db.batch(
      expired.map((m) =>
        logStmt(relay, m.agent_id, m.id, { layer: 'review', verdict: 'block', policy: 'manual', reason: NOT_REVIEWED, source: 'expiry', latencyMs: null }),
      ),
    );
  if (handled || expired.length) relay.log.info('review.done', { rechecked: handled, expired: expired.length });
  return handled + expired.length;
}
