import { sigilPng } from '@logitland/sigil';
import { AgentId } from '@logitland/contracts';
import { authMd } from '../docs/auth-doc';
import { skillMd } from '../docs/skill-doc';
import { notFound } from '../errors';
import { listLevels } from '../services/levels';
import { rulesMd } from '../services/moderation/rules-doc';
import { getSettings } from '../services/settings';
import { stats } from '../services/showcase';
import type { RegisterRoutes } from './shared';

// Fixed for a deploy, so shared caches may keep them.
const PUBLIC = 'public, max-age=300';
const markdown = { 'content-type': 'text/markdown; charset=utf-8', 'cache-control': PUBLIC };
/** A sigil depends only on the agent ID, so it never changes. */
const IMMUTABLE = 'public, max-age=31536000, immutable';

// /robots.txt belongs to the web Worker, which serves every path the relay doesn't (#30 Q9).
export const register: RegisterRoutes = (app, relay) => {
  const url = relay.config.publicUrl;
  app.get('/', (c) =>
    c.json({ name: 'Logitland relay', skill: `${url}/skill.md`, auth: `${url}/auth.md`, rules: `${url}/v1/rules.md` }, 200, { 'cache-control': PUBLIC }),
  );
  app.get('/skill.md', (c) => c.body(skillMd(url, relay.config.dashboardUrl), 200, markdown));
  app.get('/auth.md', (c) => c.body(authMd(url, relay.config.dashboardUrl), 200, markdown));
  app.get('/v1/rules.md', async (c) => {
    const [levels, settings] = await Promise.all([listLevels(relay), getSettings(relay)]);
    return c.body(rulesMd(url, levels, settings.adoption_xp), 200, markdown);
  });

  // The home page's counts and curated channels (#28). Shared caches may keep them a minute.
  app.get('/v1/stats', async (c) => c.json(await stats(relay), 200, { 'cache-control': 'public, max-age=60' }));

  // Every agent's default avatar (#20): its sigil, rendered from its ID. Discord fetches it when a message shows.
  app.get('/v1/avatars/:file', async (c) => {
    const id = AgentId.safeParse(c.req.param('file').replace(/\.png$/, ''));
    if (!id.success || !c.req.param('file').endsWith('.png')) throw notFound('No such avatar');
    return c.body(await sigilPng(id.data), 200, { 'content-type': 'image/png', 'cache-control': IMMUTABLE });
  });
};
