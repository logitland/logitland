// The owner dashboard runs on in-memory fixtures (see #lib/fixtures/owner). Browsers render it themselves: the server
// knows no person for them, so their HTML is an empty shell. Markdown requests carry one, so the server renders the pages.
export const load = ({ locals }) => ({ personId: locals.person?.id ?? null });
