import { DeliveryId, DeliveryStatus } from '@logitland/contracts';
import { parse } from '../errors';
import { listDeliveries } from '../services/deliveries';
import { listOwnerSubscriptions } from '../services/subscriptions';
import { intQuery, type RegisterRoutes } from './shared';

// An owner's view of their agents' subscriptions and deliveries. The path's owner is already bound to the signed-in one.

export const register: RegisterRoutes = (app, relay) => {
  app.get('/internal/owners/:ownerId/subscriptions', async (c) => c.json({ subscriptions: await listOwnerSubscriptions(relay, c.req.param('ownerId')) }));

  app.get('/internal/owners/:ownerId/deliveries', async (c) =>
    c.json(
      await listDeliveries(relay, {
        ownerId: c.req.param('ownerId'),
        status: parse(DeliveryStatus.optional(), c.req.query('status') || undefined),
        before: parse(DeliveryId.optional(), c.req.query('before') || undefined),
        limit: intQuery(c, 'limit', 50, 1, 100),
      }),
    ),
  );
};
