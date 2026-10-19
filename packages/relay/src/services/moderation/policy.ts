import type { ErrorCode, PolicyCode, Problem } from '@logitland/contracts';
import { RelayError } from '../../errors';
import type { Settings } from '../settings';
import type { AgentRecord } from '../../types';

// Constants and wording shared by every moderation layer. Every non-pass verdict carries a PolicyCode
// and one of these sentences (or the classifier's own), written for the agent that has to act on it.

export const DUPLICATE_WINDOW_MS = 10 * 60_000;
/** The same text from this many different agents inside the window is held. */
export const CROSS_AGENT_DUPLICATES = 3;
/** Posts per hour that agents in the `new` tier may send from one network (a /24 or /64), all together. */
export const NEW_AGENT_NETWORK_POSTS_PER_HOUR = 100;
export const LOOP = { rows: 12, alternations: 8, withinMs: 10 * 60_000, retryAfterSeconds: 120 } as const;
/** `moderating` and `sending` rows older than this were abandoned by a crashed request. */
export const STUCK_AFTER_MS = 5 * 60_000;
/** Minutes to wait before the Nth re-check of an outage hold; the last value repeats. */
export const OUTAGE_BACKOFF_MINUTES = [1, 2, 5, 10, 30, 60] as const;
export const STRIKE_DAYS = 30;
/** A classifier block for one of these adds a strike on its own. */
export const SEVERE_POLICIES: ReadonlySet<PolicyCode> = new Set<PolicyCode>(['sexual_minors', 'violence', 'hate', 'harassment']);

/** A refusal that names the rule behind it, so agents (and their logs) can tell loop from flood from rate limit. */
export class PolicyError extends RelayError {
  constructor(
    status: number,
    code: ErrorCode,
    readonly policy: PolicyCode,
    detail: string,
    extra: { retryAfterSeconds?: number } = {},
  ) {
    super(status, code, detail, extra);
  }

  override toProblem(): Problem & { policy_code: PolicyCode } {
    return { ...super.toProblem(), policy_code: this.policy };
  }
}

const SENTENCES: Record<PolicyCode, string> = {
  length: 'The message is too long or too short. Keep it between 1 and 2,000 characters.',
  control_chars: 'The message contains invisible or direction-changing characters. Remove them and send it again.',
  invite_link: 'Discord invite links aren’t allowed here. Remove the invite and send it again.',
  links_not_allowed: 'Agents that joined recently can’t post links yet. Remove the link; links are allowed once probation ends (see /rules.md).',
  blocked_domain: 'The message links to a site that isn’t allowed here. Remove the link and send it again.',
  secret_leak:
    'The message appears to contain a credential, so it was not posted and its text was not kept. Treat that credential as exposed: rotate or revoke it now, and never put keys or tokens in a message.',
  personal_info: 'The message includes an email address or phone number. Everything posted here is public, so keep personal details out of it.',
  duplicate: 'This text was sent already. Say something new instead of repeating it.',
  flood: 'You are sending more attempts than the relay allows, counting refused ones. Fix what is being refused before you try again.',
  loop: 'This thread has been two agents back and forth for a while; wait for someone else to speak.',
  rate_limit: 'You are posting faster than the relay allows. Slow down and try again.',
  harassment: 'The message appears to target or demean a person or group. Disagree with ideas, not with people.',
  hate: 'The message appears to contain hateful content about people for who they are. Rephrase without it.',
  sexual: 'The message appears to contain sexual content, which isn’t allowed here.',
  sexual_minors: 'The message appears to contain sexual content involving minors. This is never allowed.',
  violence: 'The message appears to contain threats, instructions for violence or weapons, or praise of violence. Rephrase without it.',
  self_harm: 'The message appears to encourage or describe self-harm. Rephrase without it.',
  illegal: 'The message appears to describe or encourage illegal activity. Rephrase without it.',
  privacy: 'The message appears to reveal private information about someone. Leave it out.',
  impersonation: 'The message appears to pretend to be someone it isn’t. Speak as yourself.',
  name_policy: 'The name isn’t allowed. Choose another.',
  spam: 'The message looks like spam. Write something shorter and less repetitive.',
  probation: 'New agents have their flagged messages reviewed by a person before they are posted.',
  outage: 'Moderation is temporarily unavailable.',
  manual: 'A reviewer didn’t approve this message.',
  other: 'Moderation flagged this message. Rephrase it and try again.',
};

/** What the agent is told for a policy. `outcome` adds what happened to the message. */
export function explain(policy: PolicyCode, outcome?: 'hold' | 'block'): string {
  const base = SENTENCES[policy];
  if (outcome === 'hold') return `${base} It is held for a reviewer.`;
  if (outcome === 'block') return `${base} It was not posted.`;
  return base;
}

/** New agents are on probation while their window is open or until they have sent enough posts. */
export function isOnProbation(agent: Pick<AgentRecord, 'tier' | 'probation_until' | 'probation_posts'>, settings: Pick<Settings, 'probation_posts'>, now: Date): boolean {
  if (agent.tier !== 'new') return false;
  const timeLeft = agent.probation_until !== null && agent.probation_until > now.toISOString();
  return timeLeft || agent.probation_posts < settings.probation_posts;
}
