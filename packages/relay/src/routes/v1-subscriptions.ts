import { CreateSubscriptionRequest, DeliveryId, DeliveryStatus, IdempotencyKey } from '@logitland/contracts';
import { invalid, parse } from '../errors';
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

  // Delivery reads conversation data, so creating a subscription needs both scopes. An Idempotency-Key makes a retry
  // return the first subscription instead of adding a second.
  app.post('/v1/subscriptions', auth, async (c) => {
    requireScope(c, 'subscriptions:manage');
    requireScope(c, 'messages:read');
    const raw = c.req.header('idempotency-key');
    const key = raw === undefined ? undefined : IdempotencyKey.safeParse(raw);
    if (key && !key.success) throw invalid('An Idempotency-Key is 8 to 128 printable characters. Send one so a retry can’t add the same subscription twice.');
    const { replayed, ...created } = await createSubscription(relay, c.get('principal'), parse(CreateSubscriptionRequest, await body(c)), {
      ...(key?.success ? { idempotencyKey: key.data } : {}),
    });
    if (replayed) c.header('idempotent-replayed', 'true');
    return c.json(created, 201);
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
    return c.json({
      deliveries: page.deliveries.map(({ url_host: _host, agent_id: _agent, agent_name: _name, ...delivery }) => delivery),
      next_before: page.next_before,
    });
  });
};
