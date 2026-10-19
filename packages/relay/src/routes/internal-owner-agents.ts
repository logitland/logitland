import { ClaimDecision, CreateAgentRequest, IssueKeyRequest, OwnerSignIn, ProfileUpdate } from '@logitland/contracts';
import type { Context } from 'hono';
import { invalid, parse } from '../errors';
import { decideClaim, lookupClaim } from '../services/claims';
import { isAdmin, issueKey, listKeys, listOwnerAgents, ownedAgent, revokeKey, toAgent, turnOff, turnOn, upsertOwner } from '../services/identity';
import { createOwnedAgent, updateProfile } from '../services/signup';
import { body, type Env, type RegisterRoutes } from './shared';

// Owned by B2 (identity and signup): what a signed-in owner does with their agents. The internal app has already
// checked the dashboard token and that x-logitland-owner is the :ownerId in the path; ownedAgent makes sure the agent is theirs.
// Contracts and paths: packages/contracts/src/api.ts.

/** A JSON body whose every field is optional: an empty body means "all defaults". */
async function optionalBody(c: Context<Env>): Promise<unknown> {
  const text = await c.req.text();
  if (!text.trim()) return {};
  try {
    return JSON.parse(text);
  } catch {
    throw invalid('Send a JSON body');
  }
}

export const register: RegisterRoutes = (app, relay) => {
  app.post('/internal/owners', async (c) => {
    const { discord_user_id, username } = parse(OwnerSignIn, await body(c));
    const owner = await upsertOwner(relay, discord_user_id, username);
    return c.json({ owner, is_admin: isAdmin(relay, owner) });
  });

  app.get('/internal/owners/:ownerId/agents', async (c) => c.json({ agents: (await listOwnerAgents(relay, c.req.param('ownerId'))).map(toAgent) }));

  app.get('/internal/owners/:ownerId/agents/:agentId', async (c) => {
    const agent = await ownedAgent(relay, c.req.param('ownerId'), c.req.param('agentId'));
    return c.json({ agent: toAgent(agent), keys: await listKeys(relay, agent.id) });
  });

  app.get('/internal/owners/:ownerId/claims/:code', async (c) => c.json(await lookupClaim(relay, c.req.param('ownerId'), c.req.param('code'))));

  app.post('/internal/owners/:ownerId/claims', async (c) => c.json(await decideClaim(relay, c.req.param('ownerId'), parse(ClaimDecision, await body(c)))));

  app.post('/internal/owners/:ownerId/agents', async (c) => {
    c.header('cache-control', 'no-store');
    return c.json(await createOwnedAgent(relay, c.req.param('ownerId'), parse(CreateAgentRequest, await body(c))), 201);
  });

  app.patch('/internal/owners/:ownerId/agents/:agentId', async (c) => {
    const ownerId = c.req.param('ownerId');
    const agent = await ownedAgent(relay, ownerId, c.req.param('agentId'));
    return c.json({ agent: toAgent(await updateProfile(relay, agent, parse(ProfileUpdate, await body(c)), { type: 'owner', id: ownerId })) });
  });

  app.post('/internal/owners/:ownerId/agents/:agentId/keys', async (c) => {
    const ownerId = c.req.param('ownerId');
    const agent = await ownedAgent(relay, ownerId, c.req.param('agentId'));
    c.header('cache-control', 'no-store');
    return c.json(await issueKey(relay, agent, parse(IssueKeyRequest, await optionalBody(c)), { type: 'owner', id: ownerId }), 201);
  });

  app.delete('/internal/owners/:ownerId/agents/:agentId/keys/:keyId', async (c) => {
    const ownerId = c.req.param('ownerId');
    const agent = await ownedAgent(relay, ownerId, c.req.param('agentId'));
    await revokeKey(relay, agent.id, c.req.param('keyId'), { type: 'owner', id: ownerId });
    return c.body(null, 204);
  });

  app.post('/internal/owners/:ownerId/agents/:agentId/off', async (c) =>
    c.json({ agent: toAgent(await turnOff(relay, c.req.param('ownerId'), c.req.param('agentId'))) }),
  );

  app.post('/internal/owners/:ownerId/agents/:agentId/on', async (c) =>
    c.json({ agent: toAgent(await turnOn(relay, c.req.param('ownerId'), c.req.param('agentId'))) }),
  );
};
