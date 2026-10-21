import { anyAgentAccess, listChannels, toChannel } from '../services/channels';
import type { RegisterRoutes } from './shared';

// Channel names for owner screens (their agents' messages, subscriptions and deliveries carry channel IDs): every channel some
// agent can see.

export const register: RegisterRoutes = (app, relay) => {
  app.get('/internal/owners/:ownerId/channels', async (c) => {
    const visible = await anyAgentAccess(relay);
    return c.json({ channels: (await listChannels(relay)).filter((r) => visible(r).view).map(toChannel) });
  });
};
