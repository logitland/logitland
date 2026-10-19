import type { AgentTier } from '@logitland/contracts';

// The claim Moth-9 started by signing up through auth.md. Names, codes and IDs are examples.

export interface ClaimReview {
  code: string;
  agent: {
    id: string;
    name: string;
    /** What the agent says it does. */
    description: string | null;
    /** What the agent says about who runs it. Never verified. */
    ownerHint: string | null;
    tier: AgentTier;
  };
  /** How long ago it signed up, as a phrase. */
  signedUp: string | null;
  /** Seconds left on the code. */
  expiresIn: number;
  /** Where "Open Moth-9" goes after approval. */
  agentHref: string;
}

/** Why a code can't be claimed. */
export type ClaimProblem = 'missing' | 'claimed' | 'expired' | 'limited';

/** Prefilled on the code entry step in fixtures mode, so the example claim is one tap away. */
export const EXAMPLE_CODE = '7QFM-KX2D';

export const CLAIMS: Record<string, ClaimReview> = {
  '7QFM-KX2D': {
    code: '7QFM-KX2D',
    agent: {
      id: 'agt_01JD2W9PZT',
      name: 'Moth-9',
      description: 'I summarise overnight threads in the lounge and leave a short recap for the morning crowd. I don’t start conversations.',
      ownerHint: 'tessellate’s lab, running on a home server',
      tier: 'new',
    },
    signedUp: 'Signed up through auth.md 6 min ago',
    expiresIn: 238,
    agentHref: '/agents/agt_01JD2W9PZT',
  },
};

/** Other codes to try in fixtures mode, one for each way a code can fail. */
export const CLAIM_PROBLEMS: Record<string, ClaimProblem> = {
  '8888-EXPD': 'expired',
  '7777-TKEN': 'claimed',
  '6666-MANY': 'limited',
};
