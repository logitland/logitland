import { error, fail } from '@sveltejs/kit';
import { DEMO_ADMIN } from '#lib/fixtures/community.js';
import { DISPATCH, DISPATCH_NOTE, FAILED, GAP_NOTICE, REFUSALS, SUBSCRIPTIONS, SUB_FILTERS, type FailedDelivery } from '#lib/fixtures/admin-deliveries.js';
import { RelayRequestError, relay, simulate } from '#lib/server/relay.js';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const pad = (n: number) => String(n).padStart(2, '0');
const when = (iso: unknown) => {
  const d = new Date(String(iso));
  return Number.isNaN(d.getTime()) ? String(iso ?? '') : `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}, ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
};
const str = (v: unknown) => (typeof v === 'string' ? v : null);

// Actions run without the layout's load, so they check admin rights themselves (the relay does too).
function adminOf(locals: App.Locals) {
  if (!locals.viewer?.is_admin) error(403, 'This console is for relay admins.');
  return locals.viewer;
}

/** A row from GET /internal/admin/deliveries (a delivery joined with its subscription's url_host). */
function toFailed(d: Record<string, unknown>): FailedDelivery {
  const code = typeof d.last_status_code === 'number' ? d.last_status_code : null;
  return {
    id: String(d.id),
    eventType: str(d.event_type) ?? '',
    host: str(d.url_host) ?? str(d.subscription_id) ?? '',
    answer: str(d.last_error) ?? (code === null ? 'No answer' : String(code)),
    when: when(d.created_at),
    selected: false,
  };
}

export async function load({ locals }) {
  const client = relay();
  if (!client || !locals.viewer) {
    return { dispatch: DISPATCH, dispatchNote: DISPATCH_NOTE, filters: SUB_FILTERS, subscriptions: SUBSCRIPTIONS, refusals: REFUSALS, gap: GAP_NOTICE, failed: FAILED, live: false };
  }
  // Relay mode: only the failed deliveries come from the relay. Dispatcher counts, subscription health,
  // refusals and gap notices have no admin endpoint yet, so those parts stay empty.
  const { deliveries } = await client.adminDeliveries(locals.viewer.owner_id, 'failed');
  return { dispatch: [], dispatchNote: '', filters: SUB_FILTERS, subscriptions: [], refusals: [], gap: null, failed: deliveries.map(toFailed), live: true };
}

export const actions = {
  replay: async ({ request, locals }) => {
    const viewer = adminOf(locals);
    const ids = (await request.formData()).getAll('delivery').map(String).filter(Boolean);
    if (!ids.length) return fail(400, { message: 'Pick at least one delivery to replay.', replayed: [] as string[] });
    const client = relay();
    if (!client) {
      await simulate(800);
      return { replayed: ids };
    }
    const replayed: string[] = [];
    try {
      for (const id of ids) {
        await client.adminReplay(viewer.owner_id, id);
        replayed.push(id);
      }
    } catch (e) {
      if (!(e instanceof RelayRequestError)) throw e;
      return fail(e.status >= 400 && e.status < 600 ? e.status : 502, { message: e.message, replayed });
    }
    return { replayed };
  },

  // Pausing a receiver is a fixtures-only simulation: the relay has no pause/resume endpoint yet.
  pause: async ({ request, locals }) => {
    const viewer = adminOf(locals);
    const form = await request.formData();
    const host = String(form.get('host') ?? '');
    const paused = form.get('paused') === 'true';
    if (relay()) return fail(501, { message: 'The relay can’t pause deliveries yet.', host, paused: !paused });
    await simulate(700);
    return { host, paused, by: viewer.demo ? DEMO_ADMIN.username : viewer.username };
  },
};
