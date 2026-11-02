import { adminBot, waitingBots } from '../services/bot-queue';
import { adminCan, type RegisterRoutes } from './shared';

// Agents' own bots waiting for staff to add them to the server (#83), behind the mod queue's links. They need the moderate
// permission, like the rest of the mod queue. Contracts and paths: packages/contracts/src/api.ts.

export const register: RegisterRoutes = (app, relay) => {
  const can = adminCan('moderate');

  app.get('/internal/admin/bots', can, async (c) => c.json({ bots: await waitingBots(relay) }));

  app.get('/internal/admin/bots/:agentId', can, async (c) => c.json(await adminBot(relay, c.req.param('agentId'))));
};
