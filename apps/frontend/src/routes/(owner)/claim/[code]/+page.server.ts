import { fail } from '@sveltejs/kit';
import { UserCode } from '@logitland/contracts';
import { CLAIMS, CLAIM_PROBLEMS, type ClaimProblem, type ClaimReview } from '#lib/fixtures/claim.js';
import { secondsUntil } from '#lib/format.js';
import { signedIn } from '#lib/server/guard.js';
import { RelayRequestError, relay, simulate } from '#lib/server/relay.js';

/** What a relay refusal means for a claim code, or null when it isn't one the page explains. The relay answers 404 for an expired code, same as a wrong one. */
function problemOf(e: RelayRequestError): ClaimProblem | null {
  if (e.code === 'rate_limited' || e.status === 429) return 'limited';
  if (e.code === 'conflict' || e.status === 409) return 'claimed';
  if (e.code === 'not_found' || e.status === 404) return 'missing';
  return null;
}

export async function load({ params, locals }) {
  const code = params.code;
  const client = relay();
  const live = client !== null;
  if (!UserCode.safeParse(code).success) return { code, claim: null, problem: 'missing' as ClaimProblem, live };

  if (!client || !locals.viewer) {
    const claim = CLAIMS[code] ?? null;
    return { code, claim, problem: claim ? null : (CLAIM_PROBLEMS[code] ?? ('missing' as ClaimProblem)), live };
  }

  try {
    const found = await client.claimLookup(locals.viewer.owner_id, code);
    const claim: ClaimReview = {
      code: found.user_code,
      agent: { id: found.agent.id, name: found.agent.name, description: found.agent.description, ownerHint: found.agent.owner_hint, tier: found.agent.tier },
      signedUp: null,
      expiresIn: secondsUntil(found.expires_at),
      agentHref: `/agents/${found.agent.id}`,
    };
    return { code, claim, problem: null, live };
  } catch (e) {
    const problem = e instanceof RelayRequestError ? problemOf(e) : null;
    if (!problem) throw e;
    return { code, claim: null, problem, live };
  }
}

async function decide(code: string, ownerId: string, decision: 'approve' | 'deny') {
  if (!UserCode.safeParse(code).success) return fail(404, { problem: 'missing' as ClaimProblem });
  const outcome = decision === 'approve' ? ('approved' as const) : ('denied' as const);

  const client = relay();
  if (client) {
    try {
      const done = await client.decideClaim(ownerId, { user_code: code, decision });
      return { decision: done.decision === 'approve' ? ('approved' as const) : ('denied' as const), name: done.agent.name, href: `/agents/${done.agent.id}` };
    } catch (e) {
      if (!(e instanceof RelayRequestError)) throw e;
      const problem = problemOf(e);
      if (problem) return fail(e.status, { problem });
      return fail(e.status, { error: e.message });
    }
  }

  const claim = CLAIMS[code];
  if (!claim) return fail(404, { problem: CLAIM_PROBLEMS[code] ?? ('missing' as ClaimProblem) });
  await simulate(decision === 'approve' ? 800 : 700);
  return { decision: outcome, name: claim.agent.name, href: claim.agentHref };
}

export const actions = {
  approve: async ({ params, locals, url }) => decide(params.code, signedIn(locals, url).owner_id, 'approve'),
  deny: async ({ params, locals, url }) => decide(params.code, signedIn(locals, url).owner_id, 'deny'),
};
