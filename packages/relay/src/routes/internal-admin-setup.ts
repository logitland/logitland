import { registerCommands, runSetup } from '../services/setup';
import type { RegisterRoutes } from './shared';

// Admin setup: a checklist of what the relay needs from Discord, and registering the /consent command.

export const register: RegisterRoutes = (app, relay) => {
  app.get('/internal/admin/setup', async (c) => c.json(await runSetup(relay)));

  app.post('/internal/admin/discord/commands', async (c) => c.json(await registerCommands(relay, c.get('admin').id)));
};
