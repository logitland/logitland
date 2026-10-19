import { fail } from '@sveltejs/kit';
import { DELIVERIES, OUTCOMES, RELAY_CLOCK, type DeliveryAct, type DeliveryItem } from '#lib/fixtures/deliveries.js';
import { channelList, channelNames } from '#lib/server/channel-names.js';
import { toItem } from '#lib/server/delivery-view.js';
import { signedIn } from '#lib/server/guard.js';
import { relay, simulate } from '#lib/server/relay.js';

interface DeliveriesView {
  deliveries: DeliveryItem[];
  /** The delivery shown in the detail; `?d=<id>` keeps it across reloads. */
  selected: string | null;
  /** Pass as `?before=` for older deliveries. */
  older: string | null;
  clock: string;
  live: boolean;
}

export async function load({ url, locals }): Promise<DeliveriesView> {
  const client = relay();
  const wanted = url.searchParams.get('d');
  if (client && locals.viewer) {
    // Relay mode: the owner list is the ledger with each attempt. The request that was sent isn't kept, and retry and
    // replay are admin-only, so the screen shows what happened and nothing to press.
    const ownerId = locals.viewer.owner_id;
    // The ledger doesn't say which channel an event came from, so each delivery names the channels its subscription listens to.
    const [{ deliveries, next_before }, { subscriptions }, names] = await Promise.all([
      client.listDeliveries(ownerId, { before: url.searchParams.get('before') || undefined }),
      client.listSubscriptions(ownerId),
      channelNames(client, ownerId),
    ]);
    const listening = new Map(subscriptions.map((s) => [s.id, channelList(s.channel_ids, names)]));
    const now = Date.now();
    const items = deliveries.map((d) => toItem(d, now, listening.get(d.subscription_id)));
    return {
      deliveries: items,
      selected: items.find((i) => i.id === wanted)?.id ?? items[0]?.id ?? null,
      older: next_before,
      clock: new Date(now).toISOString().slice(11, 19),
      live: true,
    };
  }
  const selected = DELIVERIES.find((d) => d.id === wanted)?.id ?? DELIVERIES[0]?.id ?? null;
  return { deliveries: DELIVERIES, selected, older: null, clock: RELAY_CLOCK, live: false };
}

// Retry now, Send again and Replay are fixtures-only: retry and replay are relay-admin actions, so in relay mode
// the buttons are hidden and the actions refuse.
async function attempt(locals: App.Locals, url: URL, request: Request, act: DeliveryAct) {
  signedIn(locals, url);
  const id = String((await request.formData()).get('id') ?? '');
  if (relay()) return fail(403, { message: 'Only relay admins can send deliveries again.' });
  const delivery = DELIVERIES.find((d) => d.id === id);
  if (!delivery) return fail(404, { message: 'No such delivery.' });
  await simulate(800);
  const outcome = OUTCOMES[act];
  return { id, act, attempt: outcome.attempt, message: outcome.message.replace('{host}', delivery.host), becomes: outcome.becomes ?? null };
}

export const actions = {
  retry: ({ locals, url, request }) => attempt(locals, url, request, 'retry'),
  send: ({ locals, url, request }) => attempt(locals, url, request, 'send'),
  replay: ({ locals, url, request }) => attempt(locals, url, request, 'replay'),
};
