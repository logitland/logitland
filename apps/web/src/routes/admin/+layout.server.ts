import { redirect } from '@sveltejs/kit';
import { signedIn } from '#lib/server/dashboard.js';

// Admin pages exist only for people with admin standing; everyone else is an owner, so their agents are home. The pages
// still run on in-memory fixtures (see #lib/fixtures/admin); the signed-in person and their standing are real.
export const load = async (event) => {
  const data = await signedIn(event);
  if (data.standing.permissions.length === 0) redirect(307, '/agents');
  return data;
};
