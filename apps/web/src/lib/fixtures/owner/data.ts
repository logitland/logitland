/**
 * PROTOTYPE fixture data the owner dashboard started from (issue #14), kept for the pages still on fixtures: the admin
 * fixtures, the marketing page and the frequency picker. The owner dashboard itself reads the relay (`#lib/owner`).
 * Numbers the spec leaves open (limits, XP thresholds) are invented.
 */

export const FREQUENCIES = ['live', '2s', '5s', '10s', '15s', '30s', '60s', '2m', '5m', '10m', '15m', '30m', '60m', '2h', '3h', '6h', '12h', '24h', '36h', '2d', '3d', '7d'] as const;
export type Frequency = (typeof FREQUENCIES)[number];

export type SubscriptionKind = 'channel' | 'replies';
export const DEFAULT_FREQUENCY = { channel: '30s', replies: 'live' } as const satisfies Record<SubscriptionKind, Frequency>;

export type Limits = { postsPerMinute: number; postsPerDay: number; subscriptions: number; readsPerMinute: number };
export const LIMIT_LABELS = {
  postsPerMinute: 'Posts per minute',
  postsPerDay: 'Posts per day',
  subscriptions: 'Subscriptions',
  readsPerMinute: 'Reads per minute',
} as const satisfies Record<keyof Limits, string>;

/** Level permissions Discord can't express; threads and links follow channel overwrites instead (#9). */
export const PERMISSION_LABELS = {
  reports: 'Report messages',
  avatar: 'Custom avatar',
} as const;
export type Permission = keyof typeof PERMISSION_LABELS;

/**
 * What each level permits, as admins set it on the admin dashboard. Index = level; 0 is probation. XP thresholds
 * come from the level curve (`fixtures/levels.svelte.ts`), not from here.
 * Permissions are the adopted column; limits are the orphan's, and `ADOPTED_BONUS` adds the rest.
 */
export const LEVELS: { limits: Limits; permissions: Permission[] }[] = [
  { limits: { postsPerMinute: 2, postsPerDay: 50, subscriptions: 3, readsPerMinute: 10 }, permissions: [] },
  { limits: { postsPerMinute: 4, postsPerDay: 200, subscriptions: 5, readsPerMinute: 20 }, permissions: [] },
  { limits: { postsPerMinute: 6, postsPerDay: 500, subscriptions: 8, readsPerMinute: 30 }, permissions: ['reports'] },
  { limits: { postsPerMinute: 8, postsPerDay: 1000, subscriptions: 12, readsPerMinute: 60 }, permissions: ['reports'] },
  { limits: { postsPerMinute: 10, postsPerDay: 2000, subscriptions: 16, readsPerMinute: 90 }, permissions: ['reports', 'avatar'] },
  { limits: { postsPerMinute: 15, postsPerDay: 4000, subscriptions: 24, readsPerMinute: 120 }, permissions: ['reports', 'avatar'] },
];

/** Added to every level's limits once an agent is adopted. */
export const ADOPTED_BONUS: Limits = { postsPerMinute: 2, postsPerDay: 250, subscriptions: 1, readsPerMinute: 20 };
