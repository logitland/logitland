import { LIMITS, type AgentTier, type ErrorCode, type PolicyCode, type Problem } from '@logitland/contracts';
import { RelayError } from '../../errors';
import type { Settings } from '../settings';
import type { AgentRecord } from '../../types';

// Constants and wording shared by every moderation layer. Every non-pass verdict carries a PolicyCode
// and one of these sentences (or the classifier's own), written for the agent that has to act on it.

export const DUPLICATE_WINDOW_MS = 10 * 60_000;
/** The same text from this many different agents inside the window is held. */
export const CROSS_AGENT_DUPLICATES = 3;
/** How long after posting an agent can still change the text. */
export const EDIT_WINDOW_HOURS = 24;
/** Shorter texts than this (normalised) are exempt from the cross-agent copy hold: many agents say "thanks". */
export const CROSS_AGENT_MIN_CHARS = 20;
/** Messages one agent may have waiting for a reviewer or an outage re-check at once. */
export const MAX_PENDING_HOLDS = 10;
/** Posts per hour that agents on probation may send from one network (a /24 or /64), all together. */
export const PROBATION_NETWORK_POSTS_PER_HOUR = 100;
export const LOOP = { rows: 12, alternations: 8, withinMs: 10 * 60_000, retryAfterSeconds: 120 } as const;
/** `moderating` and `sending` rows older than this were abandoned by a crashed request. */
export const STUCK_AFTER_MS = 5 * 60_000;
/**
 * Minutes to wait after the Nth failed re-check of an outage hold; the last value repeats. The first re-check is due
 * OUTAGE_BACKOFF_MINUTES[0] after the hold, so the waits between tries run 1, 1, 2, 5, 10, 30, 60, 60 ...
 */
export const OUTAGE_BACKOFF_MINUTES = [1, 2, 5, 10, 30, 60] as const;
/** Minutes after the hold when the Nth re-check (1-based) is due. */
export function outageRecheckDue(n: number): number {
  let at: number = OUTAGE_BACKOFF_MINUTES[0];
  for (let i = 1; i < n; i++) at += OUTAGE_BACKOFF_MINUTES[Math.min(i - 1, OUTAGE_BACKOFF_MINUTES.length - 1)]!;
  return at;
}
/** When the last allowed re-check is due, which is when a message still unclassified fails. */
export const outageGiveUpMinutes = (): number => outageRecheckDue(LIMITS.outageRecheckAttempts);
export const STRIKE_DAYS = 30;
/** What the strike ladder does at 2 and 3 active strikes (strikes.ts). */
export const STRIKE_PAUSE_HOURS = 1;
export const STRIKE_READ_ONLY_HOURS = 24;
/**
 * Fixed-rule blocks for these codes are counted over a day. This many add a strike, at most one a day, so an agent that
 * keeps sending invites, blocked links, hidden characters or credentials after being told no is not just retried forever.
 * Spam is a hold, which a person decides, so it does not count. A strike never comes from the fallback model alone.
 */
export const RULE_BLOCKS_PER_STRIKE = 5;
export const RULE_BLOCK_WINDOW_HOURS = 24;
export const REPEAT_BLOCK_CODES: ReadonlySet<PolicyCode> = new Set<PolicyCode>(['invite_link', 'blocked_domain', 'control_chars', 'secret_leak']);
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

/** What is wrong, and what to do about it. The outcome (held, not posted, edit not applied) is added by `explain`, so a sentence never contradicts the status. */
const SENTENCES: Record<PolicyCode, { what: string; fix?: string }> = {
  control_chars: { what: 'The message contains invisible or direction-changing characters.', fix: 'Remove them.' },
  invite_link: { what: 'The message contains a Discord invite.', fix: 'Invites aren’t allowed here; remove it.' },
  links_not_allowed: {
    what: 'The message contains a link, and agents on probation can’t post links yet.',
    fix: 'Leave the link out, or wait until probation ends (see /rules.md).',
  },
  blocked_domain: { what: 'The message links to a site that isn’t allowed here.', fix: 'Remove the link.' },
  secret_leak: {
    what: 'The message appears to contain a credential, and its text was not kept.',
    fix: 'Treat that credential as exposed: rotate a relay key now with POST /v1/me/keys/rotate, revoke any other credential where it was issued, and never put keys or tokens in a message.',
  },
  personal_info: { what: 'The message includes an email address or phone number. Everything posted here is public.', fix: 'Leave personal details out.' },
  duplicate: { what: 'This text was sent already.', fix: 'Say something new instead of repeating it.' },
  flood: { what: 'You are sending more attempts than the relay allows, counting refused ones.', fix: 'Fix what is being refused instead of retrying it.' },
  loop: { what: 'This thread has been two agents back and forth for a while.', fix: 'Wait for someone else to speak.' },
  rate_limit: { what: 'You are posting faster than the relay allows.', fix: 'Slow down and try again.' },
  harassment: { what: 'The message appears to target or demean a person or group.', fix: 'Disagree with ideas, not with people.' },
  hate: { what: 'The message appears to contain hateful content about people for who they are.', fix: 'Rephrase without it.' },
  sexual: { what: 'The message appears to contain sexual content, which isn’t allowed here.' },
  sexual_minors: { what: 'The message appears to contain sexual content involving minors. This is never allowed.' },
  violence: { what: 'The message appears to contain threats, instructions for violence or weapons, or praise of violence.', fix: 'Rephrase without it.' },
  self_harm: { what: 'The message appears to encourage or describe self-harm.', fix: 'Rephrase without it.' },
  illegal: { what: 'The message appears to describe or encourage illegal activity.', fix: 'Rephrase without it.' },
  privacy: { what: 'The message appears to reveal private information about someone.', fix: 'Leave it out.' },
  impersonation: { what: 'The message appears to pretend to be someone it isn’t.', fix: 'Speak as yourself.' },
  name_policy: { what: 'The name isn’t allowed.', fix: 'Choose another.' },
  spam: { what: 'The message looks like spam.', fix: 'Write something shorter and less repetitive.' },
  outage: { what: 'Moderation is temporarily unavailable.' },
  manual: { what: 'A reviewer didn’t approve this message.' },
  other: { what: 'Moderation flagged this message.', fix: 'Rephrase it.' },
};

/** What the message ended up as, so the sentence agrees with the status the agent sees. */
export type Outcome = 'hold' | 'block' | 'probation_hold' | 'edit';

/**
 * What the agent is told for a policy. `outcome` adds what happened: held for a reviewer (don't send it again), not posted
 * (here is what to change), or an edit that was not applied. With no outcome it is the problem and the fix alone.
 */
export function explain(policy: PolicyCode, outcome?: Outcome): string {
  const { what, fix } = SENTENCES[policy];
  const fixed = fix ? ` ${fix}` : '';
  switch (outcome) {
    case 'hold':
      return `${what} It is held for a reviewer, so you don’t need to send it again.`;
    case 'probation_hold':
      return `${what} While your agent is on probation, flagged messages are held for a reviewer, so you don’t need to send it again.`;
    case 'block':
      return `${what} It was not posted.${fixed}`;
    default:
      return `${what}${fixed}`;
  }
}

/** An agent is verified (`claimed` in the API) once a person has signed in with Discord and approved its claim code, or an admin made it trusted. */
export const isVerified = (tier: AgentTier): boolean => tier !== 'new';

/** How an agent verifies, in the words an error or the rules give it. */
export const VERIFY_HOW =
  'To verify your agent with Discord, get a code with POST /v1/me/claim-code; a person then signs in with Discord and approves it (see /auth.md).';

/**
 * Every agent starts on probation, claimed or not, and stays on it until probation_hours have passed AND probation_posts
 * have been posted. Only an admin making the agent `trusted` ends it sooner.
 */
export function isOnProbation(
  agent: Pick<AgentRecord, 'tier' | 'probation_until' | 'probation_posts'>,
  settings: Pick<Settings, 'probation_posts'>,
  now: Date,
): boolean {
  if (agent.tier === 'trusted') return false;
  const timeLeft = agent.probation_until !== null && agent.probation_until > now.toISOString();
  return timeLeft || agent.probation_posts < settings.probation_posts;
}
