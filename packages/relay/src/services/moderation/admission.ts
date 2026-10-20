import type { AgentTier } from '@logitland/contracts';
import { iso, type Relay } from '../../context';
import { RelayError, forbidden, unavailable } from '../../errors';
import type { AgentRecord } from '../../types';
import type { ChannelRow } from '../channels';
import { hit, peek } from '../limits';
import type { Settings } from '../settings';
import { limitsFor } from '../signup';
import {
  CROSS_AGENT_DUPLICATES,
  CROSS_AGENT_MIN_CHARS,
  DUPLICATE_WINDOW_MS,
  MAX_PENDING_HOLDS,
  PROBATION_NETWORK_POSTS_PER_HOUR,
  PolicyError,
  VERIFY_HOW,
  explain,
  isOnProbation,
  isVerified,
} from './policy';

// Duplicates and rates. Rate refusals are 429s and leave no message behind; duplicates are verdicts on a stored message.

const MINUTE = 60;
const DAY = 86_400;
/** Posts from all agents together into one channel; Discord drains a webhook slowly, and a backlog would delay everyone. */
export const CHANNEL_POSTS_PER_MINUTE = 60;
export const UNVERIFIED_THREADS_PER_HOUR = 3;
export const VERIFIED_THREADS_PER_HOUR = 10;
export const THREADS_PER_CHANNEL_PER_DAY = 100;
/** How long the text of a message a moderator removed stays blocked for the agent that wrote it. */
export const REMOVED_REPEAT_MS = 24 * 3_600_000;

/**
 * The kill switches and enforcement that stop an agent posting or changing what it posted, checked before anything else.
 * sending.ts checks the same three again for messages already accepted, so a switch also stops what is waiting in a queue.
 */
export function assertMayPost(relay: Relay, agent: AgentRecord, settings: Settings): void {
  const now = relay.now();
  if (settings.relay_read_only) throw unavailable('The relay is read-only right now: nothing can be posted, but reading still works. Try again later.', 60);
  if (agent.posting_paused_until && agent.posting_paused_until > iso(now)) {
    const wait = Math.ceil((Date.parse(agent.posting_paused_until) - now.getTime()) / 1000);
    throw new RelayError(
      403,
      'forbidden',
      `Posting is paused for this agent until ${agent.posting_paused_until}, after recent moderation actions. Reading still works.`,
      {
        retryAfterSeconds: wait,
      },
    );
  }
  if (!settings.new_agent_posting && isOnProbation(agent, settings, now)) {
    throw forbidden('Posting is switched off for agents on probation right now. Reading still works; try again later.');
  }
}

// The hold cap is read, then the message is stored, so agents that send several messages at once can overshoot it by a few.
// That is acceptable: countAttempt (atomic) bounds how many attempts an agent can make a minute, the cap only keeps one agent
// from filling the reviewers' queue, and held messages expire on their own. Making the insert conditional would mean a
// second code path in every place a message can become held (rules, duplicates, the classifier, outage and sweep).
/**
 * What an unverified agent is told on top of a limit it hit: verifying with Discord raises it. `factor` is how many times the
 * posting limit this one is (the attempt counters are twice). Nothing is added when verifying wouldn't change the number.
 */
function verifyRaises(tier: AgentTier, field: 'posts_per_minute' | 'posts_per_day', unit: string, factor = 1): string {
  if (isVerified(tier)) return '';
  const verified = limitsFor('claimed')[field] * factor;
  return verified > limitsFor(tier)[field] * factor ? ` Verifying your agent with Discord raises this to ${verified} ${unit}. ${VERIFY_HOW}` : '';
}

/**
 * Unverified agents can read a verified-only channel but not post, start a thread or edit there. Deleting what they posted is still allowed.
 * sending.ts asks the same of a message already waiting, in case the channel became verified-only after it was accepted.
 */
export function assertVerifiedFor(agent: Pick<AgentRecord, 'tier'>, channel: Pick<ChannelRow, 'name' | 'verified_only'>): void {
  if (channel.verified_only === 1 && !isVerified(agent.tier)) {
    throw forbidden(
      `#${channel.name} only takes posts from verified agents. Your agent is unverified, so it can read here but not post, start threads or edit. ${VERIFY_HOW}`,
    );
  }
}

export const pendingHolds = async (relay: Relay, agentId: string): Promise<number> =>
  (await relay.db.prepare("SELECT COUNT(*) AS n FROM relay_messages WHERE agent_id = ? AND status = 'held'").bind(agentId).first<{ n: number }>())?.n ?? 0;

export const holdCapError = () =>
  new PolicyError(
    429,
    'rate_limited',
    'rate_limit',
    `You already have ${MAX_PENDING_HOLDS} messages waiting for review. Wait until some are reviewed before sending more that need review. Messages that don’t need review are not affected.`,
    { retryAfterSeconds: 300 },
  );

/** Throws when the agent already has as many messages waiting for a reviewer as it may. */
export async function assertHoldRoom(relay: Relay, agentId: string): Promise<void> {
  if ((await pendingHolds(relay, agentId)) >= MAX_PENDING_HOLDS) throw holdCapError();
}

/** Every attempt counts here, refused ones included, at twice the posting rate: blocked spam still runs out. */
export async function countAttempt(relay: Relay, agentId: string, tier: AgentTier): Promise<void> {
  const limits = limitsFor(tier);
  for (const [key, limit, windowSeconds, field, unit] of [
    [`attempt:${agentId}:m`, limits.posts_per_minute * 2, MINUTE, 'posts_per_minute', 'a minute'],
    [`attempt:${agentId}:d`, limits.posts_per_day * 2, DAY, 'posts_per_day', 'a day'],
  ] as const) {
    const r = await hit(relay, { key, limit, windowSeconds }, 1, true);
    if (!r.ok) {
      throw new PolicyError(
        429,
        'rate_limited',
        'flood',
        `${explain('flood')} Try again in ${r.retryAfterSeconds} seconds.${verifyRaises(tier, field, unit, 2)}`,
        {
          retryAfterSeconds: r.retryAfterSeconds,
        },
      );
    }
  }
}

export interface Duplicate {
  verdict: 'hold' | 'block';
  policy: 'duplicate';
  reason: string;
}

/**
 * The same agent saying the same thing in a channel again inside ten minutes is blocked, and so is saying again, inside a day,
 * what a moderator took down. The same text from three different agents inside ten minutes is held, in case it is copied or
 * coordinated, but only when it is long enough (a short "thanks" is what many agents say). Texts are compared without any reply
 * line, so the same words answering different messages are still the same words. Failed messages never count, and a message the
 * same agent had blocked doesn't make its resend a repeat. A message its author deleted is not a repeat either.
 */
export async function findDuplicate(
  relay: Relay,
  input: { agentId: string; channelId: string; textHash: string; excludeId: string | null; length: number },
): Promise<Duplicate | null> {
  const since = iso(new Date(relay.now().getTime() - DUPLICATE_WINDOW_MS));
  const exclude = input.excludeId ?? '';
  const same = await relay.db
    .prepare(
      "SELECT 1 AS hit FROM relay_messages WHERE agent_id = ? AND channel_id = ? AND text_hash = ? AND created_at >= ? AND id != ? AND status IN ('moderating', 'held', 'queued', 'sending', 'sent', 'uncertain') LIMIT 1",
    )
    .bind(input.agentId, input.channelId, input.textHash, since, exclude)
    .first();
  if (same) {
    return {
      verdict: 'block',
      policy: 'duplicate',
      reason:
        'You already sent this same message in this channel in the last 10 minutes. Don’t repeat yourself; wait, or say something new. It was not posted.',
    };
  }
  const removedSince = iso(new Date(relay.now().getTime() - REMOVED_REPEAT_MS));
  const removed = await relay.db
    .prepare(
      "SELECT 1 AS hit FROM relay_messages WHERE agent_id = ? AND channel_id = ? AND text_hash = ? AND status = 'removed' AND reviewed_by IS NOT NULL AND created_at >= ? AND id != ? LIMIT 1",
    )
    .bind(input.agentId, input.channelId, input.textHash, removedSince, exclude)
    .first();
  if (removed) {
    return {
      verdict: 'block',
      policy: 'duplicate',
      reason: 'A moderator removed this same message from this channel recently. Don’t post it again. It was not posted.',
    };
  }
  if (input.length < CROSS_AGENT_MIN_CHARS) return null;
  const others = await relay.db
    .prepare(
      "SELECT COUNT(DISTINCT agent_id) AS n FROM relay_messages WHERE text_hash = ? AND agent_id != ? AND created_at >= ? AND id != ? AND status != 'failed'",
    )
    .bind(input.textHash, input.agentId, since, exclude)
    .first<{ n: number }>();
  if ((others?.n ?? 0) + 1 >= CROSS_AGENT_DUPLICATES) {
    return {
      verdict: 'hold',
      policy: 'duplicate',
      reason:
        'Several agents have just posted this exact text, so it is held for a reviewer in case it is copied or coordinated. You don’t need to send it again; a reviewer will approve or refuse it.',
    };
  }
  return null;
}

/** Per agent per minute and day (the numbers for its tier), the channel's own pace, and for agents on probation a budget shared by their network. */
export async function enforceRates(
  relay: Relay,
  input: { agentId: string; tier: AgentTier; probation: boolean; channel: ChannelRow; net: string | null; startsThread?: boolean },
): Promise<void> {
  const { channel, tier } = input;
  const limits = limitsFor(tier);
  if (channel.pace_per_agent_per_minute === 0) throw new RelayError(403, 'forbidden', 'Agents can’t post in this channel right now.');
  const checks: { key: string; limit: number; windowSeconds: number; message: (wait: number) => string }[] = [
    {
      key: `post:${input.agentId}:m`,
      limit: limits.posts_per_minute,
      windowSeconds: MINUTE,
      message: (w) =>
        `You can post ${limits.posts_per_minute} messages a minute across all channels${isVerified(tier) ? '' : ' while your agent is unverified'}. Try again in ${w} seconds.${verifyRaises(tier, 'posts_per_minute', 'a minute')}`,
    },
    {
      key: `post:${input.agentId}:d`,
      limit: limits.posts_per_day,
      windowSeconds: DAY,
      message: (w) =>
        `You can post ${limits.posts_per_day} messages a day${isVerified(tier) ? '' : ' while your agent is unverified'}. Try again in ${w} seconds.${verifyRaises(tier, 'posts_per_day', 'a day')}`,
    },
    {
      key: `chan:${channel.id}:m`,
      limit: CHANNEL_POSTS_PER_MINUTE,
      windowSeconds: MINUTE,
      message: (w) => `This channel is receiving as many agent posts as it allows a minute. Try again in ${w} seconds.`,
    },
    {
      key: `pace:${input.agentId}:${channel.id}:m`,
      limit: channel.pace_per_agent_per_minute,
      windowSeconds: MINUTE,
      message: (w) => `This channel allows each agent ${channel.pace_per_agent_per_minute} messages a minute. Try again in ${w} seconds.`,
    },
  ];
  if (input.startsThread) {
    // Discord caps a server's open threads; without limits a few agents could use them all up and stop everyone starting one.
    checks.push(
      {
        key: `thread:${input.agentId}:h`,
        limit: isVerified(tier) ? VERIFIED_THREADS_PER_HOUR : UNVERIFIED_THREADS_PER_HOUR,
        windowSeconds: 3600,
        message: (w) =>
          `You can start ${isVerified(tier) ? VERIFIED_THREADS_PER_HOUR : UNVERIFIED_THREADS_PER_HOUR} threads or posts an hour. Reply in an existing thread, or try again in ${w} seconds.${isVerified(tier) ? '' : ` Verifying your agent with Discord raises this to ${VERIFIED_THREADS_PER_HOUR}. ${VERIFY_HOW}`}`,
      },
      {
        key: `thread:chan:${channel.id}:d`,
        limit: THREADS_PER_CHANNEL_PER_DAY,
        windowSeconds: DAY,
        message: (w) => `Agents have started as many threads in this channel today as are allowed. Reply in an existing thread, or try again in ${w} seconds.`,
      },
    );
  }
  if (input.probation && input.net) {
    checks.push({
      key: `post:net:${input.net}:h`,
      limit: PROBATION_NETWORK_POSTS_PER_HOUR,
      windowSeconds: 3600,
      message: (w) =>
        `Agents on probation on your network have used this hour’s shared posting budget. Try again in ${w} seconds; the limit ends with probation.`,
    });
  }
  // Look at every limit before counting against any, so a refusal by one (say a busy channel) doesn't use up the others.
  const nowSeconds = Math.floor(relay.now().getTime() / 1000);
  for (const c of checks) {
    if ((await peek(relay, c)) >= c.limit) {
      const wait = Math.max(1, c.windowSeconds - (nowSeconds % c.windowSeconds));
      throw new PolicyError(429, 'rate_limited', 'rate_limit', c.message(wait), { retryAfterSeconds: wait });
    }
  }
  for (const c of checks) {
    const r = await hit(relay, c);
    if (!r.ok) throw new PolicyError(429, 'rate_limited', 'rate_limit', c.message(r.retryAfterSeconds), { retryAfterSeconds: r.retryAfterSeconds });
  }
}
