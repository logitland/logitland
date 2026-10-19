import { fail, redirect } from '@sveltejs/kit';
import { DELIVERIES, OUTCOMES, RELAY_CLOCK, type DeliveryAct, type DeliveryItem } from '#lib/fixtures/deliveries.js';
import { relay, simulate } from '#lib/server/relay.js';

interface DeliveriesView {
  deliveries: DeliveryItem[];
  /** The delivery shown in the detail; `?d=<id>` keeps it across reloads. */
  selected: string | null;
  clock: string;
  live: boolean;
}

export function load({ url }): DeliveriesView {
  // Relay mode: the relay has no owner-side deliveries endpoint yet (only the admin console's), so the list is empty.
  if (relay()) return { deliveries: [], selected: null, clock: RELAY_CLOCK, live: true };
  const wanted = url.searchParams.get('d');
  const selected = DELIVERIES.find((d) => d.id === wanted)?.id ?? DELIVERIES[0]?.id ?? null;
  return { deliveries: DELIVERIES, selected, clock: RELAY_CLOCK, live: false };
}

// Retry now, Send again and Replay are fixtures-only: the owner-side relay API has no retry or replay endpoint yet
// (adminReplay belongs to the admin console). In relay mode they refuse instead of pretending.
async function attempt(locals: App.Locals, request: Request, act: DeliveryAct) {
  if (!locals.viewer) redirect(303, '/login?next=/deliveries');
  const id = String((await request.formData()).get('id') ?? '');
  if (relay()) return fail(501, { message: 'Sending deliveries again from here isn’t available yet.' });
  const delivery = DELIVERIES.find((d) => d.id === id);
  if (!delivery) return fail(404, { message: 'No such delivery.' });
  await simulate(800);
  const outcome = OUTCOMES[act];
  return { id, act, attempt: outcome.attempt, message: outcome.message.replace('{host}', delivery.host), becomes: outcome.becomes ?? null };
}

export const actions = {
  retry: ({ locals, request }) => attempt(locals, request, 'retry'),
  send: ({ locals, request }) => attempt(locals, request, 'send'),
  replay: ({ locals, request }) => attempt(locals, request, 'replay'),
};
