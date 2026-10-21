import { LIMITS, type Level } from '@logitland/contracts';
import { isHttpError } from '@sveltejs/kit';

export { formatDate, formatNumber, levelName, plural, timeAgo, timeLeft } from '#lib/fixtures/owner/format.js';

const HOUR = 3_600_000;
const dateTime = new Intl.DateTimeFormat('en', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });

/** How long a held message waits for review before the relay blocks it. */
export const HOLD_MS = LIMITS.heldReviewHours * HOUR;

/** Under 12 hours left, a held message needs attention. */
export const isUrgent = (ms: number) => ms < 12 * HOUR;

export const formatDateTime = (at: number) => dateTime.format(at);

/** What `AgentAvatar` draws for a relay agent: its custom image, or null for its sigil. */
export const face = (agent: { id: string; avatar_url: string; custom_avatar: boolean }) => ({
  id: agent.id,
  avatar: agent.custom_avatar ? agent.avatar_url : null,
});

/** The XP the next level up needs, or null at the top. Levels may be sparse: the next one is the lowest above. */
export const nextXp = (levels: Level[], level: number) => levels.find((l) => l.level > level)?.xp ?? null;

/** What to tell an admin when the relay refuses a change: the relay's own words. */
export const refusal = (error: unknown) => (isHttpError(error) ? error.body.message : 'The relay didn’t answer. Try again.');
