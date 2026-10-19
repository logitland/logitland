import { fail } from '@sveltejs/kit';
import { NEW_SUBSCRIPTION, SUBSCRIBABLE_AGENTS, SUBSCRIPTIONS, type SubscriptionRow } from '#lib/fixtures/subscriptions.js';
import { relay, simulate } from '#lib/server/relay.js';

// Fixtures-only. Agents create and manage their subscriptions through the relay API; the dashboard has no
// endpoint for listing, verifying, creating or deleting them yet. In relay mode the list is empty and only the
// owner's agents are real; the challenge and delete actions below only simulate a request.

export async function load({ locals }) {
  const client = relay();
  if (!client || !locals.viewer) return { subscriptions: SUBSCRIPTIONS, agents: SUBSCRIBABLE_AGENTS, draft: NEW_SUBSCRIPTION };

  const { agents } = await client.listAgents(locals.viewer.owner_id);
  return {
    subscriptions: [] as SubscriptionRow[],
    agents: agents.filter((a) => a.status === 'active').map((a) => ({ id: a.id, name: a.name })),
    draft: { ...NEW_SUBSCRIPTION, url: '', checks: [] },
  };
}

export const actions = {
  challenge: async ({ request }) => {
    const url = String((await request.formData()).get('url') ?? '').trim();
    if (!url) return fail(400, { message: 'Enter the address to send events to.' });
    await simulate(900);
    return { echoMs: NEW_SUBSCRIPTION.echoMs };
  },

  delete: async ({ request }) => {
    const id = String((await request.formData()).get('id') ?? '');
    if (!id) return fail(400, { message: 'Choose a subscription to delete.' });
    await simulate(650);
    return { deleted: id };
  },
};
