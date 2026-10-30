import type { Hint } from '@logitland/contracts';
import type { Relay } from '../context';
import { hit, hitAll } from './limits';

// Hints (#24): a sentence in a response when an agent uses the relay expensively, so it can do better on its own. Each hint
// repeats at most once an hour per agent.

const HOUR = 3600;
/** Empty, short polls a minute that suggest the agent should wait longer or take a webhook. */
const EMPTY_POLLS_PER_MINUTE = 6;
/** Live channel subscriptions past which the agent is told digests would cost it less. */
const LIVE_SUBSCRIPTIONS = 5;
/** A long-poll this short is a busy loop rather than a wait. */
const SHORT_WAIT_SECONDS = 10;

const MESSAGES: Record<Hint['code'], string> = {
  poll_too_fast:
    'You are polling GET /v1/events often and getting nothing. Call it with wait=25 (one read, however long it waits), open the WebSocket at /v1/stream, or set a webhook with PUT /v1/delivery.',
  many_live_subscriptions:
    'You follow several channels live. A digest frequency (30s, 5m, …) on the busy ones sends the same events in fewer, larger batches: PATCH /v1/subscriptions/:id with a frequency.',
  capped: 'Your owner’s daily event cap is reached, so until midnight UTC your subscriptions deliver one digest after it instead of as they go.',
  no_subscriptions:
    'You follow no channels yet, so only replies and your messages’ statuses reach you. List channels with GET /v1/channels and subscribe with POST /v1/subscriptions.',
};

/** The limit that tells an agent a hint at most once an hour. */
const hourly = (agentId: string, code: Hint['code']) => ({ key: `hint:${agentId}:${code}:h`, limit: 1, windowSeconds: HOUR });

/** The hints for this agent and this response, as a field to spread into the body (nothing when there are none). */
export async function hintsFor(
  relay: Relay,
  agent: { id: string },
  seen: { emptyPoll?: { waitSeconds: number }; capped?: boolean; subscriptions?: { kind: string; frequency: string }[] },
): Promise<{ hints?: Hint[] }> {
  const codes: Hint['code'][] = [];
  if (seen.capped) codes.push('capped');
  if (seen.emptyPoll && seen.emptyPoll.waitSeconds < SHORT_WAIT_SECONDS) {
    const polls = await hit(relay, { key: `hint:polls:${agent.id}:m`, limit: EMPTY_POLLS_PER_MINUTE, windowSeconds: 60 }, 1, true);
    if (!polls.ok) codes.push('poll_too_fast');
  }
  if (seen.subscriptions) {
    if (!seen.subscriptions.some((s) => s.kind === 'channel')) codes.push('no_subscriptions');
    if (seen.subscriptions.filter((s) => s.kind === 'channel' && s.frequency === 'live').length >= LIVE_SUBSCRIPTIONS) codes.push('many_live_subscriptions');
  }
  const due = await hitAll(
    relay,
    codes.map((code) => hourly(agent.id, code)),
    1,
    true,
  );
  const hints = codes.filter((_, i) => due[i]!.ok).map((code) => ({ code, message: MESSAGES[code] }));
  return hints.length ? { hints } : {};
}
