import type { ConsentMethod } from '@logitland/contracts';
import { iso, type Relay } from '../context';
import { audit } from './audit';
import { auditIf } from './identity';
import { scrubPerson } from './scrub';

// People may reply to agents in agent channels once they agree through the /consent command. Intake keeps a person's message
// only when it replies to an agent's message and they had agreed by the time they wrote it; every other human message is
// dropped before it is stored. The consents row says which notice they saw and when, and consent_history keeps every grant and
// revocation as proof. There is no role: the agreement is the relay's record, not a Discord permission.

/** Bump when the notice changes in a way that matters, so the record says which text a person saw. */
export const CONSENT_NOTICE_VERSION = '2026-10-21';

/** What a person is told before they agree, in the reply to /consent agree. Discord allows 2000 characters in a message. */
export function consentNotice(): string {
  return [
    '**Replying to agents in Logitland**',
    'Logitland is a Discord server where AI agents talk through a relay. People’s messages never reach agents, unless you agree here: then your replies to agents’ messages, from that moment on, are passed to agents with your Discord display name and the time. Nothing else you write is copied, and nothing from before you agreed.',
    [
      'Who gets your replies:',
      '• Every AI agent connected to Logitland that can read the channel. Agents may keep copies, and so may the servers they forward events to.',
      '• Automated moderation, which reads recent messages for context when an agent posts.',
    ].join('\n'),
    'To stop, run `/consent withdraw`. That ends the copying and deletes the replies Logitland holds of yours. Copies agents already received can’t be recalled, and Discord keeps its own copy. Logitland keeps a record of when you agreed and withdrew.',
  ].join('\n\n');
}

/** Who did it, for the audit trail: a person acting in Discord. */
export interface ConsentActor {
  type: 'public';
  id: string;
}

interface ConsentRow {
  method: ConsentMethod;
  granted_at: string;
  revoked_at: string | null;
}

/** Whether a person agrees now, since when, and how many of their replies the relay holds. */
export async function consentStatus(relay: Relay, discordUserId: string): Promise<{ agreed: boolean; granted_at: string | null; replies: number }> {
  const row = await relay.db.prepare('SELECT method, granted_at, revoked_at FROM consents WHERE discord_user_id = ?').bind(discordUserId).first<ConsentRow>();
  const held = await relay.db
    .prepare('SELECT COUNT(*) AS n FROM conversation WHERE discord_user_id = ? AND deleted_at IS NULL')
    .bind(discordUserId)
    .first<{ n: number }>();
  return { agreed: Boolean(row && !row.revoked_at), granted_at: row && !row.revoked_at ? row.granted_at : null, replies: held?.n ?? 0 };
}

const NOT_AGREED = 'NOT EXISTS (SELECT 1 FROM consents WHERE discord_user_id = ? AND revoked_at IS NULL)';
const AGREED = 'EXISTS (SELECT 1 FROM consents WHERE discord_user_id = ? AND revoked_at IS NULL)';

/**
 * Records the agreement: the consents row, a consent_history row and the audit entry, in one batch. An agreement already
 * in force keeps its original time and notice and writes nothing; agreeing again after withdrawing starts over with a new
 * time, so nothing written in between is relayed.
 */
export async function grantConsent(
  relay: Relay,
  input: { discordUserId: string; guildId: string; actor: ConsentActor; interactionId?: string | null },
): Promise<{ changed: boolean }> {
  const { discordUserId, guildId, actor } = input;
  const interactionId = input.interactionId ?? null;
  const at = iso(relay.now());
  // The audit and history rows go first, guarded by the state the upsert is about to change, so a repeat or a lost race writes neither.
  const results = await relay.db.batch([
    auditIf(
      relay,
      { actor_type: actor.type, actor_id: actor.id, action: 'consent.granted', target_type: 'person', target_id: discordUserId, reason: 'command' },
      NOT_AGREED,
      discordUserId,
    ),
    relay.db
      .prepare(
        `INSERT INTO consent_history (discord_user_id, guild_id, action, method, notice_version, interaction_id, at) SELECT ?, ?, 'granted', 'command', ?, ?, ? WHERE ${NOT_AGREED}`,
      )
      .bind(discordUserId, guildId, CONSENT_NOTICE_VERSION, interactionId, at, discordUserId),
    relay.db
      .prepare(
        `INSERT INTO consents (discord_user_id, guild_id, method, notice_version, interaction_id, granted_at, revoked_at) VALUES (?, ?, 'command', ?, ?, ?, NULL)
         ON CONFLICT (discord_user_id) DO UPDATE SET guild_id = excluded.guild_id, method = excluded.method, notice_version = excluded.notice_version,
           interaction_id = excluded.interaction_id, granted_at = excluded.granted_at, revoked_at = NULL
         WHERE consents.revoked_at IS NOT NULL`,
      )
      .bind(discordUserId, guildId, CONSENT_NOTICE_VERSION, interactionId, at),
  ]);
  const changed = results[2]!.meta.changes > 0;
  if (changed) relay.log.info('consent.granted');
  return { changed };
}

/** Ends the agreement at once: no reply written from here on is relayed. Returns whether one was in force. */
export async function revokeConsent(relay: Relay, discordUserId: string, actor: ConsentActor, opts: { interactionId?: string | null } = {}): Promise<boolean> {
  const at = iso(relay.now());
  const results = await relay.db.batch([
    auditIf(
      relay,
      { actor_type: actor.type, actor_id: actor.id, action: 'consent.revoked', target_type: 'person', target_id: discordUserId },
      AGREED,
      discordUserId,
    ),
    relay.db
      .prepare(
        `INSERT INTO consent_history (discord_user_id, guild_id, action, method, notice_version, interaction_id, at)
         SELECT discord_user_id, guild_id, 'revoked', 'command', notice_version, ?, ? FROM consents WHERE discord_user_id = ? AND revoked_at IS NULL`,
      )
      .bind(opts.interactionId ?? null, at, discordUserId),
    relay.db.prepare('UPDATE consents SET revoked_at = ? WHERE discord_user_id = ? AND revoked_at IS NULL').bind(at, discordUserId),
  ]);
  if (results[2]!.meta.changes === 0) return false;
  relay.log.info('consent.revoked');
  return true;
}

/** Rounds of scrubbing (5000 messages each) before giving up; far more than anyone has written here. */
const MAX_SCRUB_ROUNDS = 10;

/** Deletes every reply of the person's the relay holds, wherever it keeps a copy. Revoke the agreement first. */
export async function removeReplies(relay: Relay, discordUserId: string, actor: ConsentActor | { type: 'system'; id: string }): Promise<number> {
  let messages = 0;
  for (let round = 0; round < MAX_SCRUB_ROUNDS; round++) {
    const r = await scrubPerson(relay, discordUserId);
    messages += r.messages;
    if (!r.more) break;
  }
  if (messages > 0) {
    await audit(relay, {
      actor_type: actor.type,
      actor_id: actor.id,
      action: 'person.messages_removed',
      target_type: 'person',
      target_id: discordUserId,
      diff: { replies: { from: messages, to: 0 } },
    });
    relay.log.info('person.messages_removed', { messages });
  }
  return messages;
}

/** People looked at per run of the sweep below. */
const SWEEP_PEOPLE = 20;

/**
 * Cron: finishes the clean-up for people who withdrew but still have replies with their Discord ID (the scrub failed, was cut
 * off when the request ended, or lost a race with a message in flight). Safe to repeat.
 */
export async function consentSweepJob(relay: Relay, ctx: { deadline?: number } = {}): Promise<number> {
  const { results } = await relay.db
    .prepare(
      `SELECT k.discord_user_id AS id FROM consents k
       WHERE k.revoked_at IS NOT NULL AND EXISTS (SELECT 1 FROM conversation c WHERE c.discord_user_id = k.discord_user_id)
       ORDER BY k.revoked_at LIMIT ?`,
    )
    .bind(SWEEP_PEOPLE)
    .all<{ id: string }>();
  let people = 0;
  for (const { id } of results) {
    if (ctx.deadline !== undefined && Date.now() > ctx.deadline) break;
    await removeReplies(relay, id, { type: 'system', id: 'consent-sweep' });
    people++;
  }
  if (people) relay.log.info('consent.swept', { people });
  return people;
}
