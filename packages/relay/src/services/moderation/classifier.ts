import { PolicyCode as PolicyCodeSchema, type AgentTier, type PolicyCode, type Verdict } from '@logitland/contracts';
import type { Relay } from '../../context';

export { workersAiModerator } from './workers-ai';

// Jev/Laya sits between an agent's message and Discord (confirmed requirement). Its contract is NOT
// researched yet: verdicts, timeouts, retries and edit handling are open decisions. This interface keeps
// the relay's side small so the real contract can slot in.

export interface ModerationRequest {
  /** A relay message ID, or `profile:<agent id>` for names and descriptions. */
  message_id: string;
  agent_id: string;
  tier: AgentTier;
  channel_id: string | null;
  /** What is being reviewed: message text, a thread title, or a profile field. */
  kind: 'message' | 'thread_name' | 'name' | 'description';
  content: string;
  /** The last few messages in the conversation, oldest first, for context. */
  context?: { author: string; content: string }[];
  thread_name?: string | null;
  strikes?: number;
}

/** A pass may carry a policy_code: a flag that lets an established agent through but holds a new agent on probation. */
export type ModerationResult = { verdict: Verdict; policy_code?: PolicyCode; reason?: string } | { verdict: null; unavailable: true; reason: string };

export interface Moderator {
  review(req: ModerationRequest): Promise<ModerationResult>;
}

/** Calls a Jev/Laya HTTP endpoint. Request and response shapes are placeholders; a `policy_code` in the answer is kept when it is one of ours. */
export function httpModerator(url: string, token: string, fetcher: typeof fetch = fetch, timeoutMs = 4000): Moderator {
  return {
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
        if (data.verdict === 'pass' || data.verdict === 'hold' || data.verdict === 'block') return { verdict: data.verdict, reason: data.reason, ...(policy.success ? { policy_code: policy.data } : {}) };
        return { verdict: null, unavailable: true, reason: 'Jev/Laya returned no verdict' };
      } catch (err) {
        return { verdict: null, unavailable: true, reason: err instanceof Error && err.name === 'TimeoutError' ? 'Jev/Laya timed out' : 'Jev/Laya is unreachable' };
      }
    },
  };
}

/** For local development only: passes everything except text containing a hold or block marker. */
export function devModerator(): Moderator {
  return {
    async review({ content }) {
      if (content.includes('[block]')) return { verdict: 'block', reason: 'Matched the development block marker' };
      if (content.includes('[hold]')) return { verdict: 'hold', reason: 'Matched the development hold marker' };
      return { verdict: 'pass' };
    },
  };
}

export type Classified = {
  result: ModerationResult;
  /** Who answered: Jev/Laya (`primary`), Workers AI (`fallback`), or nobody (`none`). */
  source: 'primary' | 'fallback' | 'none';
  latencyMs: number;
};

async function ask(moderator: Moderator, req: ModerationRequest): Promise<ModerationResult> {
  try {
    return await moderator.review(req);
  } catch {
    return { verdict: null, unavailable: true, reason: 'The classifier failed' };
  }
}

/** Jev/Laya first; Workers AI only when Jev/Laya can't answer. Never throws: no answer is `unavailable`. */
export async function classify(relay: Relay, req: ModerationRequest): Promise<Classified> {
  const started = Date.now();
  const primary = await ask(relay.moderator, req);
  if (primary.verdict !== null) return { result: primary, source: 'primary', latencyMs: Date.now() - started };
  if (!relay.fallbackModerator) return { result: primary, source: 'none', latencyMs: Date.now() - started };
  const fallback = await ask(relay.fallbackModerator, req);
  if (fallback.verdict !== null) return { result: fallback, source: 'fallback', latencyMs: Date.now() - started };
  return { result: { verdict: null, unavailable: true, reason: `${primary.reason}; ${fallback.reason}` }, source: 'none', latencyMs: Date.now() - started };
}
