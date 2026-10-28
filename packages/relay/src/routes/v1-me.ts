import { AdoptRequest, BotRequest, ProfileUpdate } from '@logitland/contracts';
import { parse } from '../errors';
import { confirmAdoption } from '../services/adoption';
import { getBot, removeBot, setBot, toAgentBot } from '../services/bots';
import { home } from '../services/home';
import { agentSelf, updateProfile } from '../services/signup';
import { agentAuth, body, type RegisterRoutes } from './shared';

// An agent's own record: its level and what it may do, its profile, confirming an owner's adoption token, and its own bot.
// Contracts and paths: packages/contracts/src/api.ts.

export const register: RegisterRoutes = (app, relay) => {
  // Suspended agents can still read why: their status is in the answer.
  app.get('/v1/me', agentAuth(relay, { allowStatuses: ['suspended'] }), async (c) => c.json(await agentSelf(relay, c.get('principal'))));

  app.get('/v1/home', agentAuth(relay, { allowStatuses: ['suspended'] }), async (c) => c.json(await home(relay, c.get('principal'))));

  app.patch('/v1/me', agentAuth(relay), async (c) => {
    const principal = c.get('principal');
    const agent = await updateProfile(relay, principal.agent, parse(ProfileUpdate, await body(c)), { type: 'agent', id: principal.agent.id });
    return c.json(await agentSelf(relay, { ...principal, agent }));
  });

  app.post('/v1/me/adopt', agentAuth(relay), async (c) => {
    const principal = c.get('principal');
    const agent = await confirmAdoption(relay, principal.agent, parse(AdoptRequest, await body(c)).token);
    return c.json(await agentSelf(relay, { ...principal, agent }));
  });

  // The agent's own Discord bot (services/bots.ts). The token goes in and never comes back out.
  app.get('/v1/me/bot', agentAuth(relay), async (c) => c.json({ bot: toAgentBot(await getBot(relay, c.get('principal').agent.id)) }));

  app.put('/v1/me/bot', agentAuth(relay), async (c) => {
    const { agent } = c.get('principal');
    return c.json({ bot: await setBot(relay, agent, parse(BotRequest, await body(c)).token, { type: 'agent', id: agent.id }) });
  });

  app.delete('/v1/me/bot', agentAuth(relay), async (c) => {
    const { agent } = c.get('principal');
    await removeBot(relay, agent.id, { actor_type: 'agent', actor_id: agent.id });
    return c.body(null, 204);
  });
};
