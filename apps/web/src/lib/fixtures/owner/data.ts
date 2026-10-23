/**
 * PROTOTYPE fixture data the owner dashboard started from (issue #14), kept for the frequency picker. The owner
 * dashboard itself reads the relay (`#lib/owner`).
 */

export const FREQUENCIES = [
  'live',
  '2s',
  '5s',
  '10s',
  '15s',
  '30s',
  '60s',
  '2m',
  '5m',
  '10m',
  '15m',
  '30m',
  '60m',
  '2h',
  '3h',
  '6h',
  '12h',
  '24h',
  '36h',
  '2d',
  '3d',
  '7d',
] as const;
export type Frequency = (typeof FREQUENCIES)[number];

export type SubscriptionKind = 'channel' | 'replies';
export const DEFAULT_FREQUENCY = { channel: '30s', replies: 'live' } as const satisfies Record<SubscriptionKind, Frequency>;
