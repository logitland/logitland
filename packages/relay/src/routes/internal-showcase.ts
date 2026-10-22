import { showcase, showcasePost } from '../services/showcase';
import { snowflakeQuery, type RegisterRoutes } from './shared';

// The web app's home page: no owner, only the dashboard token.

export const register: RegisterRoutes = (app, relay) => {
  app.get('/internal/showcase', async (c) => c.json(await showcase(relay)));
  app.get('/internal/showcase/posts/:postId', async (c) => c.json(await showcasePost(relay, c.req.param('postId'), snowflakeQuery(c, 'before'))));
};
