import { LoganAuthorization, LoganDecision, type LoganSetup } from '@logitland/contracts';
import { parse } from '../errors';
import { authorize, consent, loganUrls } from '../services/logan/oauth';
import { staffChannel } from '../services/settings';
import { adminCan, body, type RegisterRoutes } from './shared';

// The dashboard's side of the Logan admin MCP: its /oauth/authorize page checks a request and hands over the signed-in person's
// decision (the relay issues the code), and its Logan page shows how to connect and where Confirm prompts wait.

export const register: RegisterRoutes = (app, relay) => {
  app.post('/internal/owners/:ownerId/logan/consent', async (c) =>
    c.json(await consent(relay, c.req.param('ownerId'), parse(LoganAuthorization, await body(c)))),
  );

  app.post('/internal/owners/:ownerId/logan/authorize', async (c) =>
    c.json(await authorize(relay, c.req.param('ownerId'), parse(LoganDecision, await body(c)))),
  );

  app.get('/internal/admin/logan', adminCan('logan'), async (c) => {
    const id = await staffChannel(relay, 'staff_log');
    const known = id ? await relay.db.prepare('SELECT name FROM channels WHERE id = ?').bind(id).first<{ name: string }>() : null;
    return c.json({ mcp_url: loganUrls(relay).resource, staff_log_channel: id ? { id, name: known?.name ?? id } : null } satisfies LoganSetup);
  });
};
