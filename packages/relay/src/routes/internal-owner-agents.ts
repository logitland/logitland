import { BotRequest, ClaimDecision, OwnerSignIn, ProfileUpdate } from '@logitland/contracts';
import { RelayError, parse } from '../errors';
import { adminStanding } from '../services/admins';
import { cancelAdoptionToken, createAdoptionToken, getAdoptionToken } from '../services/adoption';
import { getBot, removeBot, setBot, toAgentBot } from '../services/bots';
import { decideClaim, lookupClaim } from '../services/claims';
import { deleteOwner, getOwner, listOwnerAgents, ownedAgent, revokeRegistration, toAgent, turnOff, turnOn, upsertOwner } from '../services/identity';
import { listLevels } from '../services/levels';
import { agentSelf, updateProfile } from '../services/signup';
import { body, type RegisterRoutes } from './shared';

// What a signed-in owner does with their agents. The internal app has already checked the dashboard token and that
// x-logitland-owner is the :ownerId in the path; ownedAgent makes sure the agent is theirs.
// Contracts and paths: packages/contracts/src/api.ts.

export const register: RegisterRoutes = (app, relay) => {
  app.post('/internal/owners', async (c) => {
    const { discord_user_id, username } = parse(OwnerSignIn, await body(c));
    const owner = await upsertOwner(relay, discord_user_id, username);
    // Signing in never waits on Discord: when it can't say who is an admin, is_admin is false and GET …/admin asks again.
    const standing = await adminStanding(relay, owner.discord_user_id).catch((err) => {
      if (err instanceof RelayError && err.status === 503) return null;
      throw err;
    });
    return c.json({ owner, is_admin: Boolean(standing?.permissions.length) });
  });

  app.get('/internal/owners/:ownerId/admin', async (c) => c.json(await adminStanding(relay, (await getOwner(relay, c.req.param('ownerId'))).discord_user_id)));

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

  app.get('/internal/owners/:ownerId/agents/:agentId/standing', async (c) => {
    const agent = await ownedAgent(relay, c.req.param('ownerId'), c.req.param('agentId'));
    return c.json(await agentSelf(relay, { agent, scopes: agent.scopes }));
  });

  // What each level permits, so owner screens can say which level unlocks what.
  app.get('/internal/owners/:ownerId/levels', async (c) => c.json({ levels: await listLevels(relay) }));

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

  app.get('/internal/owners/:ownerId/agents/:agentId/bot', async (c) => {
    const agent = await ownedAgent(relay, c.req.param('ownerId'), c.req.param('agentId'));
    return c.json({ bot: toAgentBot(await getBot(relay, agent.id)) });
  });

  app.put('/internal/owners/:ownerId/agents/:agentId/bot', async (c) => {
    const ownerId = c.req.param('ownerId');
    const agent = await ownedAgent(relay, ownerId, c.req.param('agentId'));
    return c.json({ bot: await setBot(relay, agent, parse(BotRequest, await body(c)).token, { type: 'owner', id: ownerId }) });
  });

  app.delete('/internal/owners/:ownerId/agents/:agentId/bot', async (c) => {
    const ownerId = c.req.param('ownerId');
    const agent = await ownedAgent(relay, ownerId, c.req.param('agentId'));
    await removeBot(relay, agent.id, { actor_type: 'owner', actor_id: ownerId });
    return c.body(null, 204);
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
