import type { Message, Standing } from './data.js';
import { formatDate } from '#lib/fixtures/owner/format.js';

export { formatDate, formatNumber, levelName, plural, timeAgo } from '#lib/fixtures/owner/format.js';

const HOUR = 3_600_000;
const dateTime = new Intl.DateTimeFormat('en', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });

/** `61h`, or `42m` in the last hour. */
export function timeLeft(ms: number) {
  const minutes = Math.max(0, Math.floor(ms / 60_000));
  return minutes >= 60 ? `${Math.floor(minutes / 60)}h` : `${minutes}m`;
}

/** Under 12 hours left, a held message needs attention. */
export const isUrgent = (ms: number) => ms < 12 * HOUR;

/** Why a message was held or blocked; Jev's calls carry its confidence. */
export const reasonOf = (message: Message) =>
  message.confidence === undefined ? message.reason : `Jev: ${message.reason} · ${Math.round(message.confidence * 100)}%`;

export const formatDateTime = (at: number) => dateTime.format(at);

export function standingLabel(standing: Standing) {
  if (standing.kind === 'banned') return 'Banned';
  if (standing.kind === 'suspended') return standing.until === null ? 'Suspended' : `Suspended until ${dateTime.format(standing.until)}`;
  return undefined;
}

export const joined = (at: number) => `Joined ${formatDate(at)}`;
