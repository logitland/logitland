import { CreateSubscriptionRequest, DeliveryId, DeliveryStatus } from '@logitland/contracts';
import { parse } from '../errors';
import { listDeliveries } from '../services/deliveries';
import { createSubscription, deleteSubscription, listSubscriptions, ownSubscription, resumeSubscription, rotateSecret } from '../services/subscriptions';
import { agentAuth, body, intQuery, requireScope, type RegisterRoutes } from './shared';

// Webhook subscriptions, for the calling agent only. Contracts and paths: packages/contracts/src/api.ts.

export const register: RegisterRoutes = (app, relay) => {
  const auth = agentAuth(relay);

  app.get('/v1/subscriptions', auth, async (c) => {
    requireScope(c, 'subscriptions:manage');
    return c.json({ subscriptions: await listSubscriptions(relay, c.get('principal').agent.id) });
  });

  // Delivery reads conversation data, so creating a subscription needs both scopes.
  app.post('/v1/subscriptions', auth, async (c) => {
    requireScope(c, 'subscriptions:manage');
    requireScope(c, 'messages:read');
    return c.json(await createSubscription(relay, c.get('principal'), parse(CreateSubscriptionRequest, await body(c))), 201);
  });

  app.delete('/v1/subscriptions/:id', auth, async (c) => {
    requireScope(c, 'subscriptions:manage');
    await deleteSubscription(relay, c.get('principal').agent.id, c.req.param('id'));
    return c.body(null, 204);
  });

  app.post('/v1/subscriptions/:id/resume', auth, async (c) => {
    requireScope(c, 'subscriptions:manage');
    return c.json(await resumeSubscription(relay, c.get('principal').agent.id, c.req.param('id')));
  });

  app.post('/v1/subscriptions/:id/rotate-secret', auth, async (c) => {
    requireScope(c, 'subscriptions:manage');
    return c.json(await rotateSecret(relay, c.get('principal').agent.id, c.req.param('id')));
  });

  app.get('/v1/subscriptions/:id/deliveries', auth, async (c) => {
    requireScope(c, 'subscriptions:manage');
    const sub = await ownSubscription(relay, c.get('principal').agent.id, c.req.param('id'));
    const page = await listDeliveries(relay, {
      subscriptionId: sub.id,
      status: parse(DeliveryStatus.optional(), c.req.query('status') || undefined),
      before: parse(DeliveryId.optional(), c.req.query('before') || undefined),
      limit: intQuery(c, 'limit', 50, 1, 100),
    });
    return c.json({ deliveries: page.deliveries.map(({ url_host: _host, agent_id: _agent, agent_name: _name, ...delivery }) => delivery), next_before: page.next_before });
  });
};
