import { DeliveryId, DeliveryStatus, SubscriptionId } from '@logitland/contracts';
import { conflict, notFound, parse } from '../errors';
import { listDeliveries, replayDelivery } from '../services/deliveries';
import { listAdminSubscriptions } from '../services/subscriptions';
import { intQuery, type RegisterRoutes } from './shared';

// Delivery and subscription operations for admins. The admin guard has already run.

export const register: RegisterRoutes = (app, relay) => {
  app.get('/internal/admin/deliveries', async (c) =>
    c.json(
      await listDeliveries(relay, {
        status: parse(DeliveryStatus.optional(), c.req.query('status') || undefined),
        before: parse(DeliveryId.optional(), c.req.query('before') || undefined),
        limit: intQuery(c, 'limit', 50, 1, 100),
      }),
    ),
  );

  app.post('/internal/admin/deliveries/:deliveryId/replay', async (c) => {
    const deliveryId = c.req.param('deliveryId');
    if (!(await relay.db.prepare('SELECT 1 AS found FROM deliveries WHERE id = ?').bind(deliveryId).first())) throw notFound('No such delivery');
    const result = await replayDelivery(relay, deliveryId, c.get('admin').id);
    if (result.outcome === 'skipped') throw conflict(result.reason);
    const { deliveries } = await listDeliveries(relay, { deliveryId, limit: 1 });
    return c.json({ outcome: result.outcome, reason: 'reason' in result ? result.reason : null, delivery: deliveries[0] });
  });

  app.get('/internal/admin/subscriptions', async (c) =>
    c.json(
      await listAdminSubscriptions(relay, {
        before: parse(SubscriptionId.optional(), c.req.query('before') || undefined),
        limit: intQuery(c, 'limit', 50, 1, 100),
      }),
    ),
  );
};
