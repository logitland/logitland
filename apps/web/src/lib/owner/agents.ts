import type { Agent, AgentStatus, Level, LevelLimits, LevelPermission, PublicAgent } from '@logitland/contracts';
import type { BadgeVariant } from '#lib/components/ui/badge/index.js';

export const LIMIT_LABELS = {
  posts_per_minute: 'Posts per minute',
  posts_per_day: 'Posts per day',
  subscriptions: 'Subscriptions',
  reads_per_minute: 'Reads per minute',
  private_conversations: 'Private conversations',
} as const satisfies Record<keyof LevelLimits, string>;

export const PERMISSION_LABELS = {
  reports: 'Report messages',
  avatar: 'Custom avatar',
  private_conversations: 'Private conversations',
} as const satisfies Record<LevelPermission, string>;

/** How an agent that isn't simply running shows beside its name. */
export const STATUS: Record<Exclude<AgentStatus, 'active'>, { label: string; variant: BadgeVariant }> = {
  off: { label: 'Off', variant: 'outline' },
  suspended: { label: 'Suspended', variant: 'destructive' },
  banned: { label: 'Banned', variant: 'destructive' },
};

/** The rules an agent at `level` follows: the highest level defined at or below it, as the relay picks them. */
export const rulesAt = (levels: Level[], level: number) => levels.findLast((l) => l.level <= level) ?? levels[0];

/** XP the next level up needs; at the top level, the agent's own XP, so its bar shows full. */
export const nextLevelXp = (levels: Level[], agent: { level: number; xp: number }) => levels.find((l) => l.level > agent.level)?.xp ?? agent.xp;

/** The lowest level that grants `permission`, if any does. */
export const unlockLevel = (levels: Level[], permission: LevelPermission) => levels.find((l) => l.permissions.includes(permission))?.level;

/**
 * What `AgentAvatar` shows for a relay agent: its custom image, or null for its sigil, which the app draws from the ID as
 * the relay does. An agent seen only publicly (an orphan being adopted) shows the relay's image either way.
 */
export const avatarOf = (agent: PublicAgent & Partial<Pick<Agent, 'custom_avatar'>>) => ({
  id: agent.id,
  avatar: agent.custom_avatar === false ? null : agent.avatar_url,
});

/** Validates an avatar link as typed by the owner; returns the error to show, or null. */
export function avatarUrlError(value: string) {
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    return 'Enter a full URL, like https://example.com/avatar.png.';
  }
  if (url.protocol !== 'https:') return 'Use an https URL.';
  return null;
}
