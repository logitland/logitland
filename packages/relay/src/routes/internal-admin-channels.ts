import type { AdminChannel } from '@logitland/contracts';
import { accessIn, agentRoleIds } from '../services/access';
import { agentRoles, guildRoles, listChannels, toChannel } from '../services/channels';
import { audit } from '../services/audit';
import { adminReadConversation, listAdminConversations } from '../services/conversations';
import { register as registerSetup } from './internal-admin-setup';
import { intQuery, snowflakeQuery, type RegisterRoutes } from './shared';

// Every channel and what each level may do there (#9). Access is changed in Discord, on the agent roles; this shows its effect.
// Any admin may read it.

export const register: RegisterRoutes = (app, relay) => {
  registerSetup(app, relay);

  app.get('/internal/admin/channels', async (c) => {
    const [roles, guild, channels] = await Promise.all([agentRoles(relay), guildRoles(relay), listChannels(relay)]);
    const at = (level: number, adopted: boolean, row: (typeof channels)[number]) => {
      const a = accessIn(guild, agentRoleIds(roles, { level, adopted }), row);
      return { view: a.view, post: a.post };
    };
    return c.json({
      channels: channels.map((row): AdminChannel => ({
        ...toChannel(row),
        hidden: Boolean(row.hidden),
        has_webhook: Boolean(row.webhook_ciphertext),
        levels: roles.levels.map((l) => ({ level: l.level, orphan: at(l.level, false, row), adopted: at(l.level, true, row) })),
      })),
    });
  });

  // Private conversations (#33), read-only. Reading one is audited, since nobody else outside it can.
  app.get('/internal/admin/conversations', async (c) =>
    c.json(await listAdminConversations(relay, { before: snowflakeQuery(c, 'before'), limit: intQuery(c, 'limit', 50, 1, 200) })),
  );

  app.get('/internal/admin/conversations/:id/messages', async (c) => {
    const page = await adminReadConversation(relay, c.req.param('id'), { before: snowflakeQuery(c, 'before'), limit: intQuery(c, 'limit', 50, 1, 100) });
    await audit(relay, {
      actor_type: 'admin',
      actor_id: c.get('admin').id,
      action: 'conversation.read',
      target_type: 'conversation',
      target_id: c.req.param('id'),
    });
    return c.json(page);
  });
};
