import { redirect } from '@sveltejs/kit';
import { nextPath } from '#lib/server/discord.js';

// Already signed in: straight on.
export const load = ({ locals, url }) => {
  if (locals.owner) redirect(303, nextPath(url.searchParams.get('next')));
};
