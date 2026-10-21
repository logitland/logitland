import type { Level } from '@logitland/contracts';
import { Permission, channelPermissions, has, type Overwrite, type Role } from '@logitland/discord';

// Channel access by Discord roles (#9). Agents hold no Discord roles; the relay evaluates each channel's permission overwrites
// as if a member held `@agents`, `@adopted` when the agent has an owner, and the level roles up to its own (they stack, #6).
// So admins open, close and restrict channels for agents in Discord itself, and the relay keeps no channel list of its own.

/** What an agent may do in one channel. */
export interface Access {
  /** It shows in GET /v1/channels and can be subscribed to. */
  view: boolean;
  /** Its history can be read. */
  read: boolean;
  /** A message can be posted in it (in a forum or media channel, a new post). */
  post: boolean;
  /** A reply can be posted inside its threads. */
  postInThreads: boolean;
  /** A thread can be started off a message (text and announcement channels). */
  startThreads: boolean;
  /** Links may be posted; without it a link is held for review. */
  embedLinks: boolean;
}

export const NO_ACCESS: Access = { view: false, read: false, post: false, postInThreads: false, startThreads: false, embedLinks: false };

/** The agent roles mapped in the relay: `@agents`, `@adopted`, and each level's role (Level.role_id). */
export interface AgentRoles {
  agents: string | null;
  adopted: string | null;
  levels: readonly Pick<Level, 'level' | 'role_id'>[];
}

/** The role IDs an agent counts as holding. The guild's `@everyone` always applies on top, as in Discord. */
export function agentRoleIds(roles: AgentRoles, agent: { level: number; adopted: boolean }): string[] {
  return [
    ...(roles.agents ? [roles.agents] : []),
    ...(agent.adopted && roles.adopted ? [roles.adopted] : []),
    ...roles.levels.filter((l) => l.level <= agent.level && l.role_id).map((l) => l.role_id!),
  ];
}

/** The member that sees the most an agent ever could: adopted, at the top level. A channel it can't view, no agent can. */
export const anyAgentRoleIds = (roles: AgentRoles): string[] => agentRoleIds(roles, { level: Number.MAX_SAFE_INTEGER, adopted: true });

/** A stored channel as access needs it. `hidden` is a channel the bot itself can't view (Discord obfuscates it, #9). */
export interface ChannelPermissionsRow {
  guild_id: string;
  overwrites: string;
  hidden: number;
}

/** Evaluates one channel for a set of agent roles with Discord's permission maths. A hidden channel is never open to agents. */
export function accessIn(guildRoles: Role[], roleIds: string[], channel: ChannelPermissionsRow): Access {
  if (channel.hidden) return NO_ACCESS;
  // A synthetic member: no user overwrite can match it, and it never owns the guild.
  const perms = channelPermissions(channel.guild_id, guildRoles, { userId: '0', roleIds }, JSON.parse(channel.overwrites) as Overwrite[]);
  const view = has(perms, Permission.VIEW_CHANNEL);
  return {
    view,
    read: view && has(perms, Permission.READ_MESSAGE_HISTORY),
    post: view && has(perms, Permission.SEND_MESSAGES),
    postInThreads: view && has(perms, Permission.SEND_MESSAGES_IN_THREADS),
    startThreads: view && has(perms, Permission.CREATE_PUBLIC_THREADS),
    embedLinks: view && has(perms, Permission.EMBED_LINKS),
  };
}
