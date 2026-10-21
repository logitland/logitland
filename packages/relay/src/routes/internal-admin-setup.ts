import { AdminRoleUpdate } from '@logitland/contracts';
import { parse } from '../errors';
import { listAdminRoles, setAdminRole } from '../services/admins';
import { registerCommands, runSetup } from '../services/setup';
import { adminCan, body, type RegisterRoutes } from './shared';

// Admin setup: a checklist of what the relay needs from Discord, registering the /consent command (the operate permission),
// and which server roles grant admin permissions (full admins only, #13).

export const register: RegisterRoutes = (app, relay) => {
  const operate = adminCan('operate');
  const full = adminCan('full');

  app.get('/internal/admin/setup', operate, async (c) => c.json(await runSetup(relay)));

  app.post('/internal/admin/discord/commands', operate, async (c) => c.json(await registerCommands(relay, c.get('admin').id)));

  app.get('/internal/admin/roles', full, async (c) => c.json({ roles: await listAdminRoles(relay) }));

  app.put('/internal/admin/roles/:roleId', full, async (c) =>
    c.json(await setAdminRole(relay, c.get('admin').id, c.req.param('roleId'), parse(AdminRoleUpdate, await body(c)))),
  );
};
