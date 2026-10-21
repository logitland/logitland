import { redirect } from '@sveltejs/kit';
import { admin } from '#lib/fixtures/admin/store.svelte.js';

// The admin dashboard runs on in-memory fixtures (see #lib/fixtures/admin). Browsers render it themselves: the server
// knows no person for them, so their HTML is an empty shell. Markdown requests carry one, so the server renders the pages,
// and sends people without admin standing to their agents, as the browser does.
export const load = ({ locals }) => {
  if (locals.person && admin.powersOf(locals.person).length === 0) redirect(307, '/agents');
  return { personId: locals.person?.id ?? null };
};
