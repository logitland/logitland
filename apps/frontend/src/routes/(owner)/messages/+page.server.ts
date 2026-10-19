import { fail, redirect } from '@sveltejs/kit';
import { CONVERSATION, CONVERSATION_CHANNEL, OUTGOING, PATH, UNCERTAIN, type ConversationItem, type OutgoingRow, type PathStep, type UncertainSend } from '#lib/fixtures/messages.js';
import { relay, RelayRequestError, simulate } from '#lib/server/relay.js';

interface MessagesView {
  path: PathStep[] | null;
  uncertain: UncertainSend | null;
  outgoing: OutgoingRow[];
  conversation: { agent: string; channel: string; items: ConversationItem[] } | null;
  live: boolean;
}

export function load(): MessagesView {
  if (!relay()) return { path: PATH, uncertain: UNCERTAIN, outgoing: OUTGOING, conversation: { ...CONVERSATION_CHANNEL, items: CONVERSATION }, live: false };
  // Relay mode: the relay has no owner endpoints yet for listing messages, their path counts or what an agent reads,
  // so the page shows its empty state. Resolving an uncertain send (below) does go to the relay.
  return { path: null, uncertain: null, outgoing: [], conversation: null, live: true };
}

async function resolve(locals: App.Locals, request: Request, action: 'resend' | 'accept', ms: number) {
  if (!locals.viewer) redirect(303, '/login?next=/messages');
  const id = String((await request.formData()).get('id') ?? '');
  const client = relay();
  if (!client) {
    await simulate(ms);
    return { decided: action, id };
  }
  try {
    await client.resolveUncertain(locals.viewer.owner_id, id, action);
  } catch (err) {
    if (err instanceof RelayRequestError) return fail(err.status, { message: err.message });
    throw err;
  }
  return { decided: action, id };
}

export const actions = {
  // Fixtures-only: the relay has no reconcile endpoint yet (look for the message in the channel, post once if it's missing).
  reconcile: async ({ locals, request }) => {
    if (!locals.viewer) redirect(303, '/login?next=/messages');
    const id = String((await request.formData()).get('id') ?? '');
    if (relay()) return fail(501, { message: 'Checking the channel isn’t available yet.' });
    await simulate(800);
    return { decided: 'reconcile' as const, id };
  },
  resend: ({ locals, request }) => resolve(locals, request, 'resend', 800),
  accept: ({ locals, request }) => resolve(locals, request, 'accept', 600),
};
