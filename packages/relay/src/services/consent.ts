import type { ConsentMethod, ConsentStatus } from '@logitland/contracts';
import { DiscordError } from '@logitland/discord';
import { iso, type Relay } from '../context';
import { audit } from './audit';
import { scrubPerson } from './scrub';

// People must agree to the public mirror before they chat in relayed channels (Discord Developer Terms,
// section 5(b): share a user's data with third parties only when they expressly direct it). The consents row,
// with its time and method, is the proof we keep. The Discord role is what lets them send messages.

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

/** Messages a person wrote that are still held, in mirrored channels only or anywhere. */
export async function messageCount(relay: Relay, discordUserId: string, scope: 'mirrored' | 'all'): Promise<number> {
  const join = scope === 'mirrored' ? 'JOIN channels ch ON ch.id = c.channel_id AND ch.public_mirror = 1' : '';
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
    mirrored_messages: await messageCount(relay, discordUserId, 'mirrored'),
  };
}

/** Grants or removes the chat role. Returns false when Discord refused; a person who isn't in the server has no role to remove. */
async function setRole(relay: Relay, guildId: string | null, discordUserId: string, grant: boolean): Promise<boolean> {
  const roleId = relay.config.discord.consentRoleId;
  if (!guildId || !roleId) return true;
  try {
    if (grant) await relay.discord.addMemberRole(guildId, discordUserId, roleId, 'Agreed to the Logitland public mirror');
    else await relay.discord.removeMemberRole(guildId, discordUserId, roleId, 'Left the Logitland public mirror');
    return true;
  } catch (err) {
    if (!grant && err instanceof DiscordError && err.status === 404) return true;
    relay.log.error('consent.role_failed', { grant, error: err });
    return false;
  }
}

/**
 * Records the agreement and gives the role. An agreement already in force keeps its original time and method.
 * The role is applied either way, so running it again repairs a person whose role call failed before.
 */
export async function grantConsent(
  relay: Relay,
  input: { discordUserId: string; guildId: string; method: ConsentMethod; actor: ConsentActor },
): Promise<{ changed: boolean; roleGranted: boolean }> {
  const { discordUserId, guildId, method, actor } = input;
  const r = await relay.db
    .prepare(
      `INSERT INTO consents (discord_user_id, guild_id, method, granted_at, revoked_at) VALUES (?, ?, ?, ?, NULL)
       ON CONFLICT (discord_user_id) DO UPDATE SET guild_id = excluded.guild_id, method = excluded.method, granted_at = excluded.granted_at, revoked_at = NULL
       WHERE consents.revoked_at IS NOT NULL`,
    )
    .bind(discordUserId, guildId, method, iso(relay.now()))
    .run();
  const changed = r.meta.changes > 0;
  if (changed) {
    await audit(relay, {
      actor_type: actor.type,
      actor_id: actor.id,
      action: 'consent.granted',
      target_type: 'person',
      target_id: discordUserId,
      reason: method,
    });
    relay.log.info('consent.granted', { method });
  }
  return { changed, roleGranted: await setRole(relay, guildId, discordUserId, true) };
}

/** Ends the agreement at once, so the public view hides the person's text from here on. Returns whether one was in force. */
export async function revokeConsent(relay: Relay, discordUserId: string, actor: ConsentActor): Promise<boolean> {
  const r = await relay.db
    .prepare('UPDATE consents SET revoked_at = ? WHERE discord_user_id = ? AND revoked_at IS NULL')
    .bind(iso(relay.now()), discordUserId)
    .run();
  if (r.meta.changes === 0) return false;
  await audit(relay, { actor_type: actor.type, actor_id: actor.id, action: 'consent.revoked', target_type: 'person', target_id: discordUserId });
  relay.log.info('consent.revoked');
  return true;
}

/** Deletes every mirrored message the person wrote, wherever the relay keeps a copy. Consent is untouched. */
export async function removeMessages(relay: Relay, discordUserId: string, actor: ConsentActor): Promise<number> {
  const { messages } = await scrubPerson(relay, discordUserId);
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

/** The second half of leaving: take the role away first so nothing new arrives, then delete what is there. Revoke consent before calling. */
export async function removePerson(
  relay: Relay,
  input: { discordUserId: string; guildId: string | null; actor: ConsentActor },
): Promise<{ messages: number; roleRemoved: boolean }> {
  const roleRemoved = await setRole(relay, input.guildId, input.discordUserId, false);
  return { messages: await removeMessages(relay, input.discordUserId, input.actor), roleRemoved };
}
