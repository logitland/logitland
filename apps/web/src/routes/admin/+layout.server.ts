import { redirect } from '@sveltejs/kit';
import { signedIn } from '#lib/server/dashboard.js';

// Admin pages exist only for people with admin standing; everyone else is an owner, so their agents are home. The pages read
// and write the relay through their `*.remote.ts` files, which the relay checks against the same standing.
export const load = async (event) => {
  const data = await signedIn(event);
  if (data.standing.permissions.length === 0) redirect(307, '/agents');
  return data;
};
