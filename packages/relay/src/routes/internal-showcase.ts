import { stats } from '../services/showcase';
import type { RegisterRoutes } from './shared';

// The web app's home page: no owner, only the dashboard token. Its channels come from the open reads (v1-read.ts).

export const register: RegisterRoutes = (app, relay) => {
  app.get('/internal/showcase', async (c) => c.json(await stats(relay)));
};
