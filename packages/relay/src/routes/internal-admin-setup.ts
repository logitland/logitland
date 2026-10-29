import { AdminRoleUpdate } from '@logitland/contracts';
import { parse } from '../errors';
import { developerTeam, listAdminRoles, setAdminRole } from '../services/admins';
import { registerCommands, runSetup, uploadEmoji } from '../services/setup';
import { adminCan, body, type RegisterRoutes } from './shared';

// Admin setup: a checklist of what the relay needs from Discord, registering the /consent command and uploading the standing
// emoji (the operate permission),
// and who the admins are (#13). Any admin may read the server's roles, which the level pages name; only full admins see the
// Developer team and map roles to admin permissions.

export const register: RegisterRoutes = (app, relay) => {
  const operate = adminCan('operate');
  const full = adminCan('full');

  app.get('/internal/admin/setup', operate, async (c) => c.json(await runSetup(relay)));

  app.post('/internal/admin/discord/commands', operate, async (c) => c.json(await registerCommands(relay, c.get('admin').id)));

  app.post('/internal/admin/discord/emoji', operate, async (c) => c.json(await uploadEmoji(relay, c.get('admin').id)));

  app.get('/internal/admin/roles', async (c) => c.json({ roles: await listAdminRoles(relay) }));

  app.put('/internal/admin/roles/:roleId', full, async (c) =>
    c.json(await setAdminRole(relay, c.get('admin').id, c.req.param('roleId'), parse(AdminRoleUpdate, await body(c)))),
  );

  app.get('/internal/admin/team', full, async (c) => c.json({ members: await developerTeam(relay) }));
};
