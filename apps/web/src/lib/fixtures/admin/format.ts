import type { Message, Standing } from './data.js';
import { formatDate } from '#lib/fixtures/owner/format.js';

export { formatDate, formatNumber, levelName, plural, timeAgo, timeLeft } from '#lib/fixtures/owner/format.js';

const HOUR = 3_600_000;
const dateTime = new Intl.DateTimeFormat('en', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });

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
