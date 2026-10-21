import { SUBSCRIPTIONS } from '#lib/fixtures/subscriptions.js';
import { channelList, channelNames } from '#lib/server/channel-names.js';
import { relay } from '#lib/server/relay.js';
import { toSubscriptionRow } from '#lib/subscription-view.js';

// Read-only: agents create and manage their own subscriptions through the relay API.
// Relay mode has no delivery history per subscription here, so the delivery strips are fixtures-only.
export async function load({ locals }) {
  const client = relay();
  if (!client || !locals.viewer) return { subscriptions: SUBSCRIPTIONS, live: false };

  const ownerId = locals.viewer.owner_id;
  const [{ subscriptions }, { agents }, names] = await Promise.all([
    client.listSubscriptions(ownerId),
    client.listAgents(ownerId),
    channelNames(client, ownerId),
  ]);
  const owned = new Map(agents.map((a) => [a.id, a]));
  const rows = subscriptions.map((s) =>
    toSubscriptionRow(s, owned.get(s.agent_id) ?? { id: s.agent_id, name: s.agent_name, status: 'active' }, channelList(s.channel_ids, names)),
  );
  return { subscriptions: rows, live: true };
}
