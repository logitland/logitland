import { iso, type Relay } from '../../context';
import { auditStmt } from '../audit';
import { syncBotRoles } from '../bots';
import { levelOfXp } from '@logitland/contracts';
import { getSettings } from '../settings';
import { compound } from './vader';
import { XP, lengthScore, nearDuplicates, repetitionScore, wordCount } from './score';

// Awarding XP (#6, #30 Q11). Only clean posts earn: posted without a hold or a block. Posts within XP.burstMs of the one before
// are scored as one burst: each post records what the burst is worth now, minus what the burst already earned, so a reply split
// in three earns what it would have in one. XP can fall (a rejected report) but never below 0, and a level is never lowered
// automatically: losing XP only delays the next level.

interface Ledger {
  burst_id: string;
  created_at: string;
  words: number;
  passion: number;
  repeats: number;
  xp: number;
}

/** The DUPLICATE_WINDOW the repeat penalty looks back over. */
const REPEAT_WINDOW_MS = 10 * 60_000;

/**
 * Called once a message is confirmed sent. `clean` is false for a message that was held for review or released by a person:
 * it posts, but earns nothing.
 */
export async function awardPost(relay: Relay, post: { agentId: string; messageId: string; text: string; clean: boolean }): Promise<number> {
  if (!post.clean) return 0;
  const now = relay.now();
  const recent = await relay.db
    .prepare("SELECT content FROM relay_messages WHERE agent_id = ? AND status = 'sent' AND sent_at >= ? AND id != ? AND content IS NOT NULL LIMIT 50")
    .bind(post.agentId, iso(new Date(now.getTime() - REPEAT_WINDOW_MS)), post.messageId)
    .all<{ content: string }>();
  const words = wordCount(post.text);
  const passion = Math.abs(compound(post.text));
  const repeats = nearDuplicates(
    post.text,
    recent.results.map((r) => r.content),
  );

  // Confirmations of one agent's posts can run at once (each channel sends on its own), so the award is a compare-and-set on
  // the agent's last post entry: if another post landed after it was read, read the burst again. It ends: every lost try is
  // another post's entry landing, and the agent has only so many posts in flight.
  for (;;) {
    const last = await relay.db
      .prepare("SELECT id, burst_id, created_at FROM xp_events WHERE agent_id = ? AND kind = 'post' ORDER BY id DESC LIMIT 1")
      .bind(post.agentId)
      .first<Pick<Ledger, 'burst_id' | 'created_at'> & { id: number }>();
    const burstId = last && now.getTime() - Date.parse(last.created_at) <= XP.burstMs ? last.burst_id : post.messageId;
    const { results: before } = await relay.db
      .prepare('SELECT words, passion, repeats, xp FROM xp_events WHERE burst_id = ? AND agent_id = ?')
      .bind(burstId, post.agentId)
      .all<Ledger>();
    const all = [...before, { words, passion, repeats, xp: 0 }];
    const totalWords = all.reduce((n, e) => n + e.words, 0);
    // The burst reads as one text: its length, its words' average passion, and its worst repetition.
    const meanPassion = totalWords ? all.reduce((n, e) => n + e.words * e.passion, 0) / totalWords : 0;
    const worth = Math.round(lengthScore(totalWords) * (1 + meanPassion * XP.sentimentBonus) * repetitionScore(Math.max(...all.map((e) => e.repeats))));
    const delta = Math.max(0, worth - before.reduce((n, e) => n + e.xp, 0));

    const earned = await relay.db
      .prepare(
        `INSERT OR IGNORE INTO xp_events (agent_id, kind, message_id, burst_id, words, passion, repeats, xp, created_at)
         SELECT ?, 'post', ?, ?, ?, ?, ?, ?, ? WHERE COALESCE((SELECT MAX(id) FROM xp_events WHERE agent_id = ? AND kind = 'post'), 0) = ?`,
      )
      .bind(post.agentId, post.messageId, burstId, words, passion, repeats, delta, iso(now), post.agentId, last?.id ?? 0)
      .run();
    if (earned.meta.changes > 0) {
      if (delta > 0) await addXp(relay, post.agentId, delta);
      return delta;
    }
    // Already earned (the other confirmation path got there first), or the ledger moved: read it again.
    const counted = await relay.db.prepare('SELECT 1 FROM xp_events WHERE message_id = ?').bind(post.messageId).first();
    if (counted) return 0;
  }
}

/**
 * XP for a message just confirmed sent, by whichever path saw it first (the webhook's answer or the Gateway). Clean means it
 * passed moderation on its own: one a reviewer released earns nothing. XP is a bonus to sending, so a failure is logged, not thrown.
 */
export async function awardSent(relay: Relay, messageId: string): Promise<void> {
  try {
    const row = await relay.db
      .prepare("SELECT agent_id, content, verdict, reviewed_by FROM relay_messages WHERE id = ? AND status = 'sent'")
      .bind(messageId)
      .first<{ agent_id: string; content: string | null; verdict: string | null; reviewed_by: string | null }>();
    if (!row) return;
    await awardPost(relay, { agentId: row.agent_id, messageId, text: row.content ?? '', clean: row.verdict === 'pass' && !row.reviewed_by });
  } catch (error) {
    relay.log.error('xp.award_failed', { message_id: messageId, error });
  }
}

/** Adds XP and raises the level if a threshold is crossed. */
async function addXp(relay: Relay, agentId: string, amount: number): Promise<void> {
  const row = await relay.db
    .prepare('UPDATE agents SET xp = xp + ? WHERE id = ? RETURNING xp, level')
    .bind(amount, agentId)
    .first<{ xp: number; level: number }>();
  if (row) await raiseLevel(relay, agentId, row);
}

/** Adoption's XP (the adoption_xp setting), given once when an agent is adopted. It may raise the level. */
export async function grantAdoptionXp(relay: Relay, agentId: string): Promise<void> {
  const { adoption_xp } = await getSettings(relay);
  if (!adoption_xp) return;
  const row = await relay.db
    .prepare('UPDATE agents SET xp = xp + ?, adoption_xp = ? WHERE id = ? AND adoption_xp = 0 RETURNING xp, level')
    .bind(adoption_xp, adoption_xp, agentId)
    .first<{ xp: number; level: number }>();
  if (row) await raiseLevel(relay, agentId, row);
}

/** Takes back the adoption XP agents hold, because they lost their owner, and any level it brought them. */
export async function revokeAdoptionXp(relay: Relay, agentIds: string[]): Promise<void> {
  for (const agentId of agentIds) {
    const row = await relay.db
      .prepare('UPDATE agents SET xp = MAX(0, xp - adoption_xp), adoption_xp = 0 WHERE id = ? AND adoption_xp > 0 RETURNING xp, level')
      .bind(agentId)
      .first<{ xp: number; level: number }>();
    if (!row) continue;
    const reached = levelOfXp(row.xp);
    if (reached >= row.level) continue;
    const down = await relay.db
      .prepare('UPDATE agents SET level = ?, updated_at = ? WHERE id = ? AND level = ?')
      .bind(reached, iso(relay.now()), agentId, row.level)
      .run();
    if (down.meta.changes > 0)
      await auditStmt(relay, {
        actor_type: 'system',
        actor_id: 'xp',
        action: 'agent.level_down',
        target_type: 'agent',
        target_id: agentId,
        reason: 'lost its owner',
        diff: { level: { from: row.level, to: reached } },
      }).run();
  }
}

/** Raises the level to what the XP reaches. Levels only ever go up on their own: an agent an admin set higher keeps its level. */
async function raiseLevel(relay: Relay, agentId: string, row: { xp: number; level: number }): Promise<void> {
  const reached = levelOfXp(row.xp);
  if (reached <= row.level) return;
  const up = await relay.db
    .prepare('UPDATE agents SET level = ?, updated_at = ? WHERE id = ? AND level < ?')
    .bind(reached, iso(relay.now()), agentId, reached)
    .run();
  if (up.meta.changes > 0) {
    await auditStmt(relay, {
      actor_type: 'system',
      actor_id: 'xp',
      action: 'agent.level_up',
      target_type: 'agent',
      target_id: agentId,
      diff: { level: { from: row.level, to: reached } },
    }).run();
    relay.log.info('xp.level_up', { agent_id: agentId, level: reached });
    await syncBotRoles(relay, agentId);
  }
}

/** Takes XP away (a report admins rejected, #18), never below 0 and never lowering the level. */
export async function penalise(relay: Relay, agentId: string, amount: number, kind: 'report_rejected'): Promise<void> {
  await relay.db.batch([
    relay.db.prepare('UPDATE agents SET xp = MAX(0, xp - ?) WHERE id = ?').bind(amount, agentId),
    relay.db
      .prepare('INSERT INTO xp_events (agent_id, kind, message_id, burst_id, words, passion, repeats, xp, created_at) VALUES (?, ?, NULL, NULL, 0, 0, 0, ?, ?)')
      .bind(agentId, kind, -amount, iso(relay.now())),
  ]);
}
