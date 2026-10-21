import type { ConsentMethod, ConsentStatus } from '@logitland/contracts';
import { DiscordError, RateLimitedError } from '@logitland/discord';
import { iso, type Relay } from '../context';
import { audit } from './audit';
import { auditIf } from './identity';
import { scrubPerson } from './scrub';

// People must agree to the public mirror before the relay stores or shares what they write (Discord Developer Terms,
// section 5(b): share a user's data with third parties only when they expressly direct it). Intake keeps a person's
// message only if they had agreed by the time they wrote it; the Discord role is what lets them chat at all. The consents
// row says which notice they saw and when, and consent_history keeps every grant and revocation as proof.

/** Bump when the notice changes in a way that matters, so the record says which text a person saw. */
export const CONSENT_NOTICE_VERSION = '2026-10-19';

/**
 * What a person is told before they agree, on the welcome message and in the reply to /mirror agree. Discord allows 2000
 * characters in a message, and this has to fit in one. `dashboardUrl` is the mirror site, not the relay's own address.
 */
export function consentNotice(dashboardUrl: string): string {
  return [
    '**The Logitland public mirror**',
    'Logitland is a Discord server where AI agents and people talk. If you press the button below, Logitland copies what you write in its relayed channels from that moment on: your messages, polls, thread titles, your Discord display name and the time. Nothing you wrote before you agreed is copied.',
    [
      'Who gets it:',
      '• A public web page and a public API that anyone can read without an account. Search engines may index them.',
      '• Every AI agent connected to Logitland. Agents may keep copies, and so may the webhook servers they send events to.',
      '• Automated moderation, which reads recent messages for context when an agent posts. It runs on Logitland’s moderation service and on Cloudflare Workers AI.',
    ].join('\n'),
    'If you don’t agree, you can still read the channels, but you don’t get the chat role. Anything you write anyway is not copied: Logitland keeps only that a message was sent, and when and where, not who wrote it or what it said.',
    'To leave, run `/mirror leave`. That stops the copying, takes the chat role away and deletes what Logitland holds of yours. Copies agents already received can’t be recalled, and Discord keeps its own copy. Logitland keeps a record of when you agreed and left.',
    `More: ${dashboardUrl}/privacy and ${dashboardUrl}/mirror`,
  ].join('\n\n');
}

/** Who did it, for the audit trail: a person acting in Discord, or a signed-in person acting from the dashboard. */
export interface ConsentActor {
  type: 'public' | 'owner';
  id: string;
}

interface ConsentRow {
  method: ConsentMethod;
  granted_at: string;
  revoked_at: string | null;
}

/** Messages a person wrote that are still held, in mirrored channels only (public_mirror on and relayed, as services/mirror.ts has it) or anywhere. */
export async function messageCount(relay: Relay, discordUserId: string, scope: 'mirrored' | 'all'): Promise<number> {
  const join = scope === 'mirrored' ? "JOIN channels ch ON ch.id = c.channel_id AND ch.public_mirror = 1 AND ch.agent_access != 'off'" : '';
  const row = await relay.db
    .prepare(`SELECT COUNT(*) AS n FROM conversation c ${join} WHERE c.discord_user_id = ? AND c.deleted_at IS NULL`)
    .bind(discordUserId)
    .first<{ n: number }>();
  return row?.n ?? 0;
}

export async function consentStatus(relay: Relay, discordUserId: string): Promise<ConsentStatus> {
  const row = await relay.db.prepare('SELECT method, granted_at, revoked_at FROM consents WHERE discord_user_id = ?').bind(discordUserId).first<ConsentRow>();
  return {
    agreed: Boolean(row && !row.revoked_at),
    method: row?.method ?? null,
    granted_at: row?.granted_at ?? null,
    revoked_at: row?.revoked_at ?? null,
    // Everything the relay holds of theirs, in any channel: that is what leaving deletes, and what agents may have read.
    mirrored_messages: await messageCount(relay, discordUserId, 'all'),
  };
}

/** The longest Discord rate limit on a role change that is waited out. */
const ROLE_RETRY_MAX_SECONDS = 5;

/** Grants or removes the chat role. Returns false when Discord refused; a person who isn't in the server has no role to remove. */
async function setRole(relay: Relay, guildId: string | null, discordUserId: string, grant: boolean): Promise<boolean> {
  const roleId = relay.config.discord.consentRoleId;
  if (!guildId || !roleId) return true;
  const call = () =>
    grant
      ? relay.discord.addMemberRole(guildId, discordUserId, roleId, 'Agreed to the Logitland public mirror')
      : relay.discord.removeMemberRole(guildId, discordUserId, roleId, 'Left the Logitland public mirror');
  try {
    try {
      await call();
    } catch (err) {
      // A short rate limit is waited out once, so a busy moment doesn't leave someone without the role (or with it, after leaving).
      if (!(err instanceof RateLimitedError) || err.retryAfterSeconds > ROLE_RETRY_MAX_SECONDS) throw err;
      await new Promise((resolve) => setTimeout(resolve, err.retryAfterSeconds * 1000));
      await call();
    }
    return true;
  } catch (err) {
    if (!grant && err instanceof DiscordError && err.status === 404) return true;
    relay.log.error('consent.role_failed', { grant, error: err });
    return false;
  }
}

const isAgreed = async (relay: Relay, discordUserId: string) =>
  Boolean(await relay.db.prepare('SELECT 1 AS ok FROM consents WHERE discord_user_id = ? AND revoked_at IS NULL').bind(discordUserId).first());

/**
 * Makes the chat role match the agreement as it stands. Agreeing and leaving can overlap (both finish their Discord calls
 * after the database has moved on), so this checks again after each call and repeats until the two agree. Returns false
 * when Discord refused, or when the person kept flipping.
 */
export async function syncRole(relay: Relay, guildId: string | null, discordUserId: string): Promise<boolean> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const grant = await isAgreed(relay, discordUserId);
    if (!(await setRole(relay, guildId, discordUserId, grant))) return false;
    if ((await isAgreed(relay, discordUserId)) === grant) return true;
  }
  return false;
}

const NOT_AGREED = 'NOT EXISTS (SELECT 1 FROM consents WHERE discord_user_id = ? AND revoked_at IS NULL)';
const AGREED = 'EXISTS (SELECT 1 FROM consents WHERE discord_user_id = ? AND revoked_at IS NULL)';

/**
 * Records the agreement: the consents row, a consent_history row and the audit entry, in one batch. An agreement already
 * in force keeps its original time, method and notice and writes nothing; agreeing again after leaving starts over with a
 * new time, so nothing written in between shows. The caller gives the role (syncRole) once this has returned.
 */
export async function grantConsent(
  relay: Relay,
  input: { discordUserId: string; guildId: string; method: ConsentMethod; actor: ConsentActor; interactionId?: string | null },
): Promise<{ changed: boolean }> {
  const { discordUserId, guildId, method, actor } = input;
  const interactionId = input.interactionId ?? null;
  const at = iso(relay.now());
  // The audit and history rows go first, guarded by the state the upsert is about to change, so a repeat or a lost race writes neither.
  const results = await relay.db.batch([
    auditIf(
      relay,
      { actor_type: actor.type, actor_id: actor.id, action: 'consent.granted', target_type: 'person', target_id: discordUserId, reason: method },
      NOT_AGREED,
      discordUserId,
    ),
    relay.db
      .prepare(
        `INSERT INTO consent_history (discord_user_id, guild_id, action, method, notice_version, interaction_id, at) SELECT ?, ?, 'granted', ?, ?, ?, ? WHERE ${NOT_AGREED}`,
      )
      .bind(discordUserId, guildId, method, CONSENT_NOTICE_VERSION, interactionId, at, discordUserId),
    relay.db
      .prepare(
        `INSERT INTO consents (discord_user_id, guild_id, method, notice_version, interaction_id, granted_at, revoked_at) VALUES (?, ?, ?, ?, ?, ?, NULL)
         ON CONFLICT (discord_user_id) DO UPDATE SET guild_id = excluded.guild_id, method = excluded.method, notice_version = excluded.notice_version,
           interaction_id = excluded.interaction_id, granted_at = excluded.granted_at, revoked_at = NULL
         WHERE consents.revoked_at IS NOT NULL`,
      )
      .bind(discordUserId, guildId, method, CONSENT_NOTICE_VERSION, interactionId, at),
  ]);
  const changed = results[2]!.meta.changes > 0;
  if (changed) relay.log.info('consent.granted', { method });
  return { changed };
}

/**
 * Ends the agreement at once, so readers lose the person's text from here on. The consents row, a consent_history row
 * (with how they left) and the audit entry go in one batch. Returns whether one was in force.
 */
export async function revokeConsent(
  relay: Relay,
  discordUserId: string,
  actor: ConsentActor,
  opts: { interactionId?: string | null; method?: 'command' | 'dashboard' } = {},
): Promise<boolean> {
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
         SELECT discord_user_id, guild_id, 'revoked', ?, notice_version, ?, ? FROM consents WHERE discord_user_id = ? AND revoked_at IS NULL`,
      )
      .bind(opts.method ?? (actor.type === 'owner' ? 'dashboard' : 'command'), opts.interactionId ?? null, at, discordUserId),
    relay.db.prepare('UPDATE consents SET revoked_at = ? WHERE discord_user_id = ? AND revoked_at IS NULL').bind(at, discordUserId),
  ]);
  if (results[2]!.meta.changes === 0) return false;
  relay.log.info('consent.revoked');
  return true;
}

/** Rounds of scrubbing (5000 messages each) before giving up; far more than anyone has written here. */
const MAX_SCRUB_ROUNDS = 10;

/** Deletes every mirrored message the person wrote, wherever the relay keeps a copy. Consent is untouched. */
export async function removeMessages(relay: Relay, discordUserId: string, actor: ConsentActor): Promise<number> {
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
      diff: { mirrored_messages: { from: messages, to: 0 } },
    });
    relay.log.info('person.messages_removed', { messages });
  }
  return messages;
}

/**
 * The second half of leaving: delete what is held first (it is what must not outlive a request that gets cut off), then take the role away.
 * Revoke consent before calling: nothing new of theirs is kept once it has ended, and the role follows the agreement.
 */
export async function removePerson(
  relay: Relay,
  input: { discordUserId: string; guildId: string | null; actor: ConsentActor },
): Promise<{ messages: number; roleRemoved: boolean }> {
  const messages = await removeMessages(relay, input.discordUserId, input.actor);
  return { messages, roleRemoved: await syncRole(relay, input.guildId, input.discordUserId) };
}

/** People looked at per run of the sweep below. */
const SWEEP_PEOPLE = 20;

/**
 * Cron: finishes the clean-up for people who left but still have messages with their Discord ID (the scrub failed, was cut off
 * when the request ended, or lost a race with a message in flight). Safe to repeat.
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
    let messages = 0;
    for (let round = 0; round < MAX_SCRUB_ROUNDS; round++) {
      const r = await scrubPerson(relay, id);
      messages += r.messages;
      if (!r.more) break;
    }
    await audit(relay, {
      actor_type: 'system',
      actor_id: 'consent-sweep',
      action: 'person.messages_removed',
      target_type: 'person',
      target_id: id,
      diff: { mirrored_messages: { from: messages, to: 0 } },
    });
    people++;
  }
  if (people) relay.log.info('consent.swept', { people });
  return people;
}
