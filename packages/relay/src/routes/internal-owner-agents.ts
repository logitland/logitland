import { ClaimDecision, OwnerSignIn, ProfileUpdate } from '@logitland/contracts';
import { parse } from '../errors';
import { cancelAdoptionToken, createAdoptionToken, getAdoptionToken } from '../services/adoption';
import { decideClaim, lookupClaim } from '../services/claims';
import { deleteOwner, isAdmin, listOwnerAgents, ownedAgent, revokeRegistration, toAgent, turnOff, turnOn, upsertOwner } from '../services/identity';
import { updateProfile } from '../services/signup';
import { body, type RegisterRoutes } from './shared';

// What a signed-in owner does with their agents. The internal app has already checked the dashboard token and that
// x-logitland-owner is the :ownerId in the path; ownedAgent makes sure the agent is theirs.
// Contracts and paths: packages/contracts/src/api.ts.

export const register: RegisterRoutes = (app, relay) => {
  app.post('/internal/owners', async (c) => {
    const { discord_user_id, username } = parse(OwnerSignIn, await body(c));
    const owner = await upsertOwner(relay, discord_user_id, username);
    return c.json({ owner, is_admin: isAdmin(relay, owner) });
  });

  app.delete('/internal/owners/:ownerId', async (c) => {
    await deleteOwner(relay, c.req.param('ownerId'));
    return c.body(null, 204);
  });

  app.get('/internal/owners/:ownerId/agents', async (c) =>
    c.json({ agents: (await listOwnerAgents(relay, c.req.param('ownerId'))).map((a) => toAgent(relay, a)) }),
  );

  app.get('/internal/owners/:ownerId/agents/:agentId', async (c) =>
    c.json({ agent: toAgent(relay, await ownedAgent(relay, c.req.param('ownerId'), c.req.param('agentId'))) }),
  );

  app.get('/internal/owners/:ownerId/claims/:code', async (c) => c.json(await lookupClaim(relay, c.req.param('ownerId'), c.req.param('code'))));

  app.post('/internal/owners/:ownerId/claims', async (c) => c.json(await decideClaim(relay, c.req.param('ownerId'), parse(ClaimDecision, await body(c)))));

  app.post('/internal/owners/:ownerId/adoption-tokens', async (c) => {
    c.header('cache-control', 'no-store');
    return c.json(await createAdoptionToken(relay, c.req.param('ownerId')), 201);
  });

  app.get('/internal/owners/:ownerId/adoption-tokens/:token', async (c) => c.json(await getAdoptionToken(relay, c.req.param('ownerId'), c.req.param('token'))));

  app.delete('/internal/owners/:ownerId/adoption-tokens/:token', async (c) => {
    await cancelAdoptionToken(relay, c.req.param('ownerId'), c.req.param('token'));
    return c.body(null, 204);
  });

  app.patch('/internal/owners/:ownerId/agents/:agentId', async (c) => {
    const ownerId = c.req.param('ownerId');
    const agent = await ownedAgent(relay, ownerId, c.req.param('agentId'));
    return c.json({ agent: toAgent(relay, await updateProfile(relay, agent, parse(ProfileUpdate, await body(c)), { type: 'owner', id: ownerId })) });
  });

  app.delete('/internal/owners/:ownerId/agents/:agentId', async (c) => {
    const ownerId = c.req.param('ownerId');
    await revokeRegistration(relay, await ownedAgent(relay, ownerId, c.req.param('agentId')), { type: 'owner', id: ownerId });
    return c.body(null, 204);
  });

  app.post('/internal/owners/:ownerId/agents/:agentId/off', async (c) =>
    c.json({ agent: toAgent(relay, await turnOff(relay, c.req.param('ownerId'), c.req.param('agentId'))) }),
  );

  app.post('/internal/owners/:ownerId/agents/:agentId/on', async (c) =>
    c.json({ agent: toAgent(relay, await turnOn(relay, c.req.param('ownerId'), c.req.param('agentId'))) }),
  );
};
