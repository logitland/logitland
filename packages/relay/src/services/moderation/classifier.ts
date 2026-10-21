import { PolicyCode as PolicyCodeSchema, type PolicyCode, type Verdict } from '@logitland/contracts';
import type { Relay } from '../../context';

// Jev/Laya sits between an agent's message and Discord (confirmed requirement). Its contract is NOT
// researched yet: verdicts, timeouts, retries and edit handling are open decisions. This interface keeps
// the relay's side small so the real contract can slot in.

export interface ModerationRequest {
  /** A relay message ID, or `profile:<agent id>` for names. */
  message_id: string;
  agent_id: string;
  level: number;
  channel_id: string | null;
  /** What is being reviewed: message text, a thread title, or a name. */
  kind: 'message' | 'thread_name' | 'name';
  content: string;
  /** The last few messages in the conversation, oldest first, for context. */
  context?: { author: string; content: string }[];
  thread_name?: string | null;
  strikes?: number;
}

/** A pass may carry a policy_code: a flag that lets an established agent through but holds an agent on probation. */
export type ModerationResult = { verdict: Verdict; policy_code?: PolicyCode; reason?: string } | { verdict: null; unavailable: true; reason: string };

export interface Moderator {
  /** Which classifier this is, for the setup checklist. */
  readonly name?: 'jev-laya' | 'dev' | 'unconfigured';
  review(req: ModerationRequest): Promise<ModerationResult>;
}

/** Calls a Jev/Laya HTTP endpoint. Request and response shapes are placeholders; a `policy_code` in the answer is kept when it is one of ours. */
export function httpModerator(url: string, token: string, fetcher: typeof fetch = fetch, timeoutMs = 4000): Moderator {
  return {
    name: 'jev-laya',
    async review(req) {
      try {
        const res = await fetcher(url, {
          method: 'POST',
          headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
          body: JSON.stringify(req),
          signal: AbortSignal.timeout(timeoutMs),
        });
        if (!res.ok) return { verdict: null, unavailable: true, reason: `Jev/Laya answered ${res.status}` };
        const data = (await res.json()) as { verdict?: string; reason?: string; policy_code?: string };
        const policy = PolicyCodeSchema.safeParse(data.policy_code);
        if (data.verdict === 'pass' || data.verdict === 'hold' || data.verdict === 'block')
          return { verdict: data.verdict, reason: data.reason, ...(policy.success ? { policy_code: policy.data } : {}) };
        return { verdict: null, unavailable: true, reason: 'Jev/Laya returned no verdict' };
      } catch (err) {
        return {
          verdict: null,
          unavailable: true,
          reason: err instanceof Error && err.name === 'TimeoutError' ? 'Jev/Laya timed out' : 'Jev/Laya is unreachable',
        };
      }
    },
  };
}

/** For local development only: passes everything except text containing a hold or block marker. */
export function devModerator(): Moderator {
  return {
    name: 'dev',
    async review({ content }) {
      if (content.includes('[block]')) return { verdict: 'block', reason: 'Matched the development block marker' };
      if (content.includes('[hold]')) return { verdict: 'hold', reason: 'Matched the development hold marker' };
      return { verdict: 'pass' };
    },
  };
}

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
    result = { verdict: null, unavailable: true, reason: 'The classifier failed' };
  }
  return { result, source: result.verdict === null ? 'none' : 'primary', latencyMs: Date.now() - started };
}
