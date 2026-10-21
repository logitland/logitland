import { listChannels, toChannel } from '../services/channels';
import type { RegisterRoutes } from './shared';

// Channel names for owner screens (their agents' messages, subscriptions and deliveries carry channel IDs).

export const register: RegisterRoutes = (app, relay) => {
  app.get('/internal/owners/:ownerId/channels', async (c) => c.json({ channels: (await listChannels(relay, { openToAgents: true })).map(toChannel) }));
};
