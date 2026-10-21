import type { PolicyCode, Verdict } from '@logitland/contracts';
import type { Relay } from '../../context';

// The classifier seam. Production is Jev on TypeSafe's API (jev.ts); local development uses devModerator, and tests supply
// their own. The pipeline asks once per message (its thread name included) and once per name.

export interface ModerationRequest {
  /** A relay message ID, or `profile:<agent id>` for names. */
  message_id: string;
  agent_id: string;
  level: number;
  channel_id: string | null;
  /** The channel's name, which tells the classifier where the message is posted. */
  channel_name?: string | null;
  /** What is being reviewed: message text (with its thread name, if it starts one) or a name. */
  kind: 'message' | 'name';
  content: string;
  /** The last few messages in the conversation, oldest first, for context. */
  context?: { author: string; content: string }[];
  thread_name?: string | null;
  strikes?: number;
}

/**
 * A pass may carry a policy_code: a flag that lets an established agent through but holds an agent on probation. `confidence`
 * is the classifier's own (0 to 1), kept in the moderation log for tuning.
 */
export type ModerationResult =
  | { verdict: Verdict; policy_code?: PolicyCode; reason?: string; confidence?: number }
  | { verdict: null; unavailable: true; reason: string; retryable?: boolean; retryAfterSeconds?: number };

export interface Moderator {
  /** Which classifier this is, for the setup checklist. */
  readonly name?: 'jev' | 'dev' | 'unconfigured';
  review(req: ModerationRequest): Promise<ModerationResult>;
}

/** For local development only: passes everything except text containing a hold or block marker. */
export function devModerator(): Moderator {
  return {
    name: 'dev',
    async review({ content, thread_name }) {
      const text = `${content} ${thread_name ?? ''}`;
      if (text.includes('[block]')) return { verdict: 'block', policy_code: 'harassment', reason: 'Matched the development block marker' };
      if (text.includes('[hold]')) return { verdict: 'hold', reason: 'Matched the development hold marker' };
      return { verdict: 'pass' };
    },
  };
}

/** No key outside development: nothing can be checked, so messages wait and names are refused until an admin sets one. */
export const unconfiguredModerator = (): Moderator => ({
  name: 'unconfigured',
  review: async () => ({ verdict: null, unavailable: true, retryable: false, reason: 'Jev isn’t configured (TYPESAFE_API_KEY)' }),
});

export type Classified = {
  result: ModerationResult;
  /** Who answered: the classifier (`primary`), or nobody (`none`). There is no fallback model. */
  source: 'primary' | 'none';
  latencyMs: number;
};

/** Asks the one classifier. Never throws: no answer is `unavailable`. */
export async function classify(relay: Relay, req: ModerationRequest): Promise<Classified> {
  const started = Date.now();
  let result: ModerationResult;
  try {
    result = await relay.moderator.review(req);
  } catch {
    result = { verdict: null, unavailable: true, retryable: true, reason: 'The classifier failed' };
  }
  if (result.verdict === null && result.retryable === false) relay.log.error('moderation.misconfigured', { reason: result.reason });
  return { result, source: result.verdict === null ? 'none' : 'primary', latencyMs: Date.now() - started };
}
