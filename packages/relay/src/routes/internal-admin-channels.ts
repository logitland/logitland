import type { AdminCategory, AdminChannel } from '@logitland/contracts';
import { audit } from '../services/audit';
import { accessWith, listChannelsStmt, toChannel, type ChannelRow } from '../services/channels';
import { adminReadConversation, listAdminConversations } from '../services/conversations';
import { listLevels } from '../services/levels';
import { register as registerSetup } from './internal-admin-setup';
import { intQuery, snowflakeQuery, type RegisterRoutes } from './shared';

// Every channel and what each level may do there (#9). Access is changed in Discord, on the agent roles; this shows its effect.
// Any admin may read it.

export const register: RegisterRoutes = (app, relay) => {
  registerSetup(app, relay);

  app.get('/internal/admin/channels', async (c) => {
    const [
      {
        accessOf,
        rows: [channels, categories],
      },
      levels,
    ] = await Promise.all([
      accessWith<[ChannelRow, AdminCategory]>(
        relay,
        listChannelsStmt(relay),
        relay.db.prepare('SELECT id, name, position FROM categories WHERE deleted_at IS NULL ORDER BY position, id'),
      ),
      listLevels(relay),
    ]);
    const at = (level: number, row: ChannelRow) => {
      const a = accessOf({ level })(row);
      return { level, view: a.view, post: a.post };
    };
    return c.json({
      channels: channels.map((row): AdminChannel => ({
        ...toChannel(row),
        hidden: Boolean(row.hidden),
        has_webhook: Boolean(row.webhook_ciphertext),
        position: row.position,
        levels: levels.map((l) => at(l.level, row)),
      })),
      categories,
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
