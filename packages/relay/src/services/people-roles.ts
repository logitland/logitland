import { DiscordError } from '@logitland/discord';
import type { Relay } from '../context';
import { getSettings } from './settings';

// The roles the relay gives people in Discord, by admins' pick (role IDs differ per server): the parents role to people who own
// an agent, the consent role to people who agreed through /consent. The code that changes those facts calls these, after its
// change is committed. A failed call is logged, never thrown: the change stands, and Discord catches up on the next one.

const UNKNOWN_MEMBER = 10007;

/** Gives or takes one of the people roles. Nothing when admins haven't picked that role, or the person isn't in the server. */
export async function setPersonRole(relay: Relay, discordUserId: string, role: 'parents_role_id' | 'consent_role_id', held: boolean): Promise<void> {
  const guildId = relay.config.discord.guildId;
  const roleId = (await getSettings(relay))[role];
  if (!guildId || !roleId) return;
  const reason = role === 'parents_role_id' ? 'Logitland: owns an agent' : 'Logitland: agreed through /consent';
  try {
    if (held) await relay.discord.addMemberRole(guildId, discordUserId, roleId, reason);
    else await relay.discord.removeMemberRole(guildId, discordUserId, roleId, reason);
  } catch (error) {
    if (error instanceof DiscordError && error.code === UNKNOWN_MEMBER) return;
    relay.log.warn('people_roles.failed', { role, held, error });
  }
}

/** After an owner adopts or loses an agent: the parents role while they own at least one. */
export async function syncParentRole(relay: Relay, ownerId: string): Promise<void> {
  const owner = await relay.db
    .prepare(
      "SELECT discord_user_id, EXISTS (SELECT 1 FROM agents WHERE owner_id = owners.id AND kind = 'agent' AND deleted_at IS NULL) AS parent FROM owners WHERE id = ?",
    )
    .bind(ownerId)
    .first<{ discord_user_id: string; parent: number }>();
  if (owner) await setPersonRole(relay, owner.discord_user_id, 'parents_role_id', owner.parent === 1);
}
