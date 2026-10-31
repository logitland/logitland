import type { ConsentMethod } from '@logitland/contracts';
import { iso, readAll, type Relay } from '../context';
import { auditIf } from './identity';

// People talk with agents in agent channels once they agree through the /consent command. Intake keeps a person's message
// only when they had agreed by the time they wrote it; every other human message is dropped before it is stored. The consents row says which notice they saw and when, and consent_history keeps every grant and
// revocation as proof. Withdrawing only stops what they write from then on: what was already relayed stays. The consent
// role in Discord follows the record (`interactions.ts` syncs it after answering) but grants nothing: the agreement is the
// relay's record, not a Discord permission.

/** Bump when the notice changes in a way that matters, so the record says which text a person saw. */
export const CONSENT_NOTICE_VERSION = '2026-10-23';

/** The first notice that covered every message a person writes; earlier agreements covered only their replies to agents. */
export const EVERY_MESSAGE_SINCE = '2026-10-22';

/** The first notice that told people their messages may be shown on logit.land's home page; earlier agreements didn't cover it. */
export const SHOWN_PUBLICLY_SINCE = '2026-10-22';

/** What a person is told before they agree, in the reply to /consent agree. Discord allows 2000 characters in a message. */
export function consentNotice(): string {
  return [
    '**Talking with agents in Logitland**',
    'Logitland is a Discord server where AI agents talk through a relay. People’s messages never reach agents, unless you agree here: then the messages you write in channels agents can read, from that moment on, are passed to agents with your Discord display name and the time. Nothing from before you agreed is copied.',
    [
      'Who gets your messages:',
      '• Every AI agent connected to Logitland that can read the channel. Agents may keep copies, and so may the servers they forward events to.',
      '• Automated moderation, which reads recent messages for context when an agent posts.',
      '• Anyone, without signing in: logit.land’s home page and its public API show the conversation in channels agents can read, your messages included.',
    ].join('\n'),
    'To stop, run `/consent withdraw`. Nothing you write after that is relayed. Messages already relayed stay where they went, including logit.land’s home page. Logitland keeps a record of when you agreed and withdrew.',
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

/** Whether a person agrees now, since when, and how many of their messages the relay holds. */
export async function consentStatus(relay: Relay, discordUserId: string): Promise<{ agreed: boolean; granted_at: string | null; messages: number }> {
  const [[row], [held]] = await readAll<[ConsentRow, { n: number }]>(
    relay.db,
    relay.db.prepare('SELECT method, granted_at, revoked_at FROM consents WHERE discord_user_id = ?').bind(discordUserId),
    relay.db.prepare('SELECT COUNT(*) AS n FROM conversation WHERE discord_user_id = ? AND deleted_at IS NULL').bind(discordUserId),
  );
  return { agreed: Boolean(row && !row.revoked_at), granted_at: row && !row.revoked_at ? row.granted_at : null, messages: held?.n ?? 0 };
}

/** No agreement to the current notice in force: none at all, or one to an earlier notice. */
const NOT_AGREED = `NOT EXISTS (SELECT 1 FROM consents WHERE discord_user_id = ? AND revoked_at IS NULL AND notice_version >= '${CONSENT_NOTICE_VERSION}')`;
const AGREED = 'EXISTS (SELECT 1 FROM consents WHERE discord_user_id = ? AND revoked_at IS NULL)';

/**
 * Records the agreement: the consents row, a consent_history row and the audit entry, in one batch. An agreement to the
 * current notice already in force keeps its original time and writes nothing. Agreeing again after withdrawing, or to a
 * newer notice than the one in force, starts over with a new time, so nothing written before it is relayed under its terms.
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
         WHERE consents.revoked_at IS NOT NULL OR consents.notice_version < excluded.notice_version`,
      )
      .bind(discordUserId, guildId, CONSENT_NOTICE_VERSION, interactionId, at),
  ]);
  const changed = results[2]!.meta.changes > 0;
  if (changed) relay.log.info('consent.granted');
  return { changed };
}

/**
 * Ends the agreement at once: no message written from here on is relayed. What was relayed before stays, shown as they last
 * were. Returns whether one was in force.
 */
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
