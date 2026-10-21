import { DeliveryId, DeliveryStatus, OwnerDeliveryPatch, SubscriptionPatch } from '@logitland/contracts';
import { parse } from '../errors';
import { auditStmt } from '../services/audit';
import { listDeliveries } from '../services/deliveries';
import { countDeliveredToday } from '../services/feed';
import { ownedAgent } from '../services/identity';
import { listOwnerSubscriptions, ownerSubscription, updateSubscription } from '../services/subscriptions';
import { getWebhook, toDeliverySetting } from '../services/webhook';
import { body, intQuery, type RegisterRoutes } from './shared';

// An owner's view of their agents' subscriptions and deliveries, their frequencies and daily caps (#23, #24). The path's
// owner is already bound to the signed-in one.

export const register: RegisterRoutes = (app, relay) => {
  app.get('/internal/owners/:ownerId/subscriptions', async (c) => c.json({ subscriptions: await listOwnerSubscriptions(relay, c.req.param('ownerId')) }));

  app.patch('/internal/owners/:ownerId/subscriptions/:subscriptionId', async (c) => {
    const ownerId = c.req.param('ownerId');
    const sub = await ownerSubscription(relay, ownerId, c.req.param('subscriptionId'));
    return c.json(await updateSubscription(relay, sub.agent_id, sub.id, parse(SubscriptionPatch, await body(c)), { type: 'owner', id: ownerId }));
  });

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

  app.get('/internal/owners/:ownerId/agents/:agentId/delivery', async (c) => {
    const agent = await ownedAgent(relay, c.req.param('ownerId'), c.req.param('agentId'));
    return c.json({
      delivery: toDeliverySetting(await getWebhook(relay, agent.id)),
      daily_event_cap: agent.daily_event_cap,
      delivered_today: await countDeliveredToday(relay, agent.id),
    });
  });

  app.patch('/internal/owners/:ownerId/agents/:agentId/delivery', async (c) => {
    const ownerId = c.req.param('ownerId');
    const agent = await ownedAgent(relay, ownerId, c.req.param('agentId'));
    const { daily_event_cap } = parse(OwnerDeliveryPatch, await body(c));
    await relay.db.batch([
      relay.db.prepare('UPDATE agents SET daily_event_cap = ?, updated_at = ? WHERE id = ?').bind(daily_event_cap, relay.now().toISOString(), agent.id),
      auditStmt(relay, {
        actor_type: 'owner',
        actor_id: ownerId,
        action: 'agent.cap_set',
        target_type: 'agent',
        target_id: agent.id,
        diff: { daily_event_cap: { from: agent.daily_event_cap, to: daily_event_cap } },
      }),
    ]);
    return c.json({
      delivery: toDeliverySetting(await getWebhook(relay, agent.id)),
      daily_event_cap,
      delivered_today: await countDeliveredToday(relay, agent.id),
    });
  });
};
