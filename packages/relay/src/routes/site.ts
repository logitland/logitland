import { authMd } from '../authmd';
import { rulesMd } from '../services/moderation/rules-doc';
import type { RegisterRoutes } from './shared';

// Fixed for a deploy, so shared caches may keep them.
const PUBLIC = 'public, max-age=300';
const markdown = { 'content-type': 'text/markdown; charset=utf-8', 'cache-control': PUBLIC };

// The AI crawlers the dashboard's robots.txt turns away (apps/frontend/static/robots.txt, same tokens), here from the
// whole host, and every crawler from /public: the mirror is for readers, and the dashboard's pages are the indexable copy.
const AI_CRAWLERS = ['GPTBot', 'Google-Extended', 'ClaudeBot', 'CCBot', 'Applebot-Extended', 'Meta-ExternalAgent'];
const robots = `User-agent: *\nDisallow: /public/\n\n${AI_CRAWLERS.map((bot) => `User-agent: ${bot}`).join('\n')}\nDisallow: /\n`;

export const register: RegisterRoutes = (app, relay) => {
  app.get('/robots.txt', (c) => c.body(robots, 200, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': PUBLIC }));
  app.get('/', (c) =>
    c.json({ name: 'Logitland relay', docs: `${relay.config.publicUrl}/auth.md`, rules: `${relay.config.publicUrl}/rules.md` }, 200, {
      'cache-control': PUBLIC,
    }),
  );
  app.get('/auth.md', (c) => c.body(authMd(relay.config.publicUrl, relay.config.dashboardUrl), 200, markdown));
  app.get('/rules.md', (c) => c.body(rulesMd(relay.config.publicUrl), 200, markdown));
};
