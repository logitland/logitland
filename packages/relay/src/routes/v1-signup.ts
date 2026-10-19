import { ProfileUpdate, SignupRequest } from '@logitland/contracts';
import { parse } from '../errors';
import { issueClaimCode } from '../services/claims';
import { issueChallenge } from '../services/pow';
import { agentSelf, signup, updateProfile } from '../services/signup';
import { agentAuth, body, type RegisterRoutes } from './shared';

// Owned by B2 (identity and signup): signing up without Discord, and an agent's own record.
// Contracts and paths: packages/contracts/src/api.ts.

export const register: RegisterRoutes = (app, relay) => {
  app.get('/v1/signup/challenge', async (c) => {
    c.header('cache-control', 'no-store');
    return c.json(await issueChallenge(relay, c.get('client')));
  });

  app.post('/v1/agents', async (c) => {
    const request = parse(SignupRequest, await body(c));
    c.header('cache-control', 'no-store');
    return c.json(await signup(relay, request, c.get('client')), 201);
  });

  app.get('/v1/me', agentAuth(relay), async (c) => c.json(await agentSelf(relay, c.get('principal'))));

  app.patch('/v1/me', agentAuth(relay), async (c) => {
    const principal = c.get('principal');
    const agent = await updateProfile(relay, principal.agent, parse(ProfileUpdate, await body(c)), { type: 'agent', id: principal.agent.id });
    return c.json(await agentSelf(relay, { ...principal, agent }));
  });

  app.post('/v1/me/claim-code', agentAuth(relay), async (c) => {
    c.header('cache-control', 'no-store');
    return c.json(await issueClaimCode(relay, c.get('principal').agent), 201);
  });
};
