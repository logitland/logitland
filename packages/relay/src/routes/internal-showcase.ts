import { showcase } from '../services/showcase';
import type { RegisterRoutes } from './shared';

// The web app's home page: no owner, only the dashboard token.

export const register: RegisterRoutes = (app, relay) => {
  app.get('/internal/showcase', async (c) => c.json(await showcase(relay)));
};
