import { CreateSubscriptionRequest, DeliveryId, DeliveryRequest, DeliveryStatus, SubscriptionPatch } from '@logitland/contracts';
import { invalid, notFound, parse } from '../errors';
import { accessWith, listChannelsStmt, type ChannelRow } from '../services/channels';
import { listDeliveries } from '../services/deliveries';
import { DIGEST_MAX, readFeed, readableIn, type SubscriptionRow } from '../services/feed';
import { hintsFor } from '../services/hints';
import { listSubscriptions, ownSubscriptionStmt, subscribe, unsubscribe, updateSubscription } from '../services/subscriptions';
import { getWebhook, removeWebhook, resumeWebhook, rotateWebhookSecret, setWebhook, toDeliverySetting } from '../services/webhook';
import { agentAuth, body, countRead, intQuery, requireScope, type RegisterRoutes } from './shared';

// Subscriptions and the agent's one delivery setting (#11, #23), for the calling agent only.
// Contracts and paths: packages/contracts/src/api.ts.

export const register: RegisterRoutes = (app, relay) => {
  const auth = agentAuth(relay);

  app.get('/v1/subscriptions', auth, async (c) => {
    requireScope(c, 'subscriptions:manage');
    const { agent } = c.get('principal');
    const subscriptions = await listSubscriptions(relay, agent.id);
    return c.json({ subscriptions, ...(await hintsFor(relay, agent, { subscriptions })) });
  });

  // Delivery reads conversation data, so subscribing needs both scopes.
  app.post('/v1/subscriptions', auth, async (c) => {
    requireScope(c, 'subscriptions:manage');
    requireScope(c, 'messages:read');
    const { subscription, created } = await subscribe(relay, c.get('principal').agent, parse(CreateSubscriptionRequest, await body(c)));
    return c.json(subscription, created ? 201 : 200);
  });

  app.patch('/v1/subscriptions/:id', auth, async (c) => {
    requireScope(c, 'subscriptions:manage');
    return c.json(await updateSubscription(relay, c.get('principal').agent.id, c.req.param('id'), parse(SubscriptionPatch, await body(c))));
  });

  app.delete('/v1/subscriptions/:id', auth, async (c) => {
    requireScope(c, 'subscriptions:manage');
    await unsubscribe(relay, c.get('principal').agent.id, c.req.param('id'));
    return c.body(null, 204);
  });

  app.get('/v1/subscriptions/:id/events', auth, async (c) => {
    requireScope(c, 'messages:read');
    await countRead(relay, c);
    const { agent } = c.get('principal');
    const {
      accessOf,
      rows: [[sub], channels],
    } = await accessWith<[SubscriptionRow, ChannelRow]>(relay, ownSubscriptionStmt(relay, agent.id, c.req.param('id')), listChannelsStmt(relay));
    if (!sub) throw notFound('No such subscription');
    const raw = c.req.query('after');
    if (raw !== undefined && !/^\d{1,15}$/.test(raw)) throw invalid('after must be a cursor from an earlier digest or event');
    const readable = readableIn(channels, accessOf(agent));
    const page = await readFeed(relay, sub, raw === undefined ? sub.cursor : Number(raw), intQuery(c, 'limit', DIGEST_MAX, 1, DIGEST_MAX), readable);
    c.header('cache-control', 'no-store');
    return c.json({ events: page.events, cursor: String(page.last), more: page.more });
  });

  app.get('/v1/delivery', auth, async (c) => {
    requireScope(c, 'subscriptions:manage');
    return c.json(toDeliverySetting(await getWebhook(relay, c.get('principal').agent.id)));
  });

  app.put('/v1/delivery', auth, async (c) => {
    requireScope(c, 'subscriptions:manage');
    c.header('cache-control', 'no-store');
    return c.json(await setWebhook(relay, c.get('principal').agent.id, parse(DeliveryRequest, await body(c)).url));
  });

  app.delete('/v1/delivery', auth, async (c) => {
    requireScope(c, 'subscriptions:manage');
    await removeWebhook(relay, c.get('principal').agent.id);
    return c.body(null, 204);
  });

  app.post('/v1/delivery/resume', auth, async (c) => {
    requireScope(c, 'subscriptions:manage');
    return c.json(await resumeWebhook(relay, c.get('principal').agent.id));
  });

  app.post('/v1/delivery/rotate-secret', auth, async (c) => {
    requireScope(c, 'subscriptions:manage');
    c.header('cache-control', 'no-store');
    return c.json(await rotateWebhookSecret(relay, c.get('principal').agent.id));
  });

  app.get('/v1/delivery/deliveries', auth, async (c) => {
    requireScope(c, 'subscriptions:manage');
    const page = await listDeliveries(relay, {
      agentId: c.get('principal').agent.id,
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
