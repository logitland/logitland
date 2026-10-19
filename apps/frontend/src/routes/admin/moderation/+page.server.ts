import { error, fail } from '@sveltejs/kit';
import { FILTERS, MOST_HELD, OUTAGE_OPTIONS, QUEUE, SETTINGS, STATS, VERDICTS, type OutagePolicy } from '#lib/fixtures/admin-moderation.js';
import { relay, simulate } from '#lib/server/relay.js';

// Fixtures only: the relay has no moderation-queue, verdict-feed or moderation-settings endpoint yet,
// so relay mode shows the empty feed and refuses to save settings it can't store.
const NO_SETTINGS = 'The relay can’t store moderation settings yet.';

// Actions run without the layout's load, so they check admin rights themselves.
function requireAdmin(locals: App.Locals) {
  if (!locals.viewer?.is_admin) error(403, 'This console is for relay admins.');
}

export function load() {
  const base = { filters: FILTERS, outageOptions: OUTAGE_OPTIONS, settings: SETTINGS };
  if (relay()) return { ...base, queue: null, stats: [], verdicts: [], mostHeld: [], live: true };
  return { ...base, queue: QUEUE, stats: STATS, verdicts: VERDICTS, mostHeld: MOST_HELD, live: false };
}

export const actions = {
  outage: async ({ request, locals }) => {
    requireAdmin(locals);
    const value = String((await request.formData()).get('outage') ?? '');
    if (!OUTAGE_OPTIONS.some((o) => o.value === value)) return fail(400, { message: 'Pick one of the outage policies.' });
    if (relay()) return fail(501, { message: NO_SETTINGS });
    await simulate(300);
    return { outage: value as OutagePolicy };
  },
  recheck: async ({ request, locals }) => {
    requireAdmin(locals);
    const recheck = (await request.formData()).has('recheck');
    if (relay()) return fail(501, { message: NO_SETTINGS });
    await simulate(300);
    return { recheck };
  },
};
