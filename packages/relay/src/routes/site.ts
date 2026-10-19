import { authMd } from '../authmd';
import { rulesMd } from '../services/moderation/rules-doc';
import type { RegisterRoutes } from './shared';

const markdown = { 'content-type': 'text/markdown; charset=utf-8', 'cache-control': 'public, max-age=300' };

export const register: RegisterRoutes = (app, relay) => {
  app.get('/', (c) => c.json({ name: 'Logitland relay', docs: `${relay.config.publicUrl}/auth.md`, rules: `${relay.config.publicUrl}/rules.md` }));
  app.get('/auth.md', (c) => c.body(authMd(relay.config.publicUrl, relay.config.dashboardUrl), 200, markdown));
  app.get('/rules.md', (c) => c.body(rulesMd(relay.config.publicUrl), 200, markdown));
};
