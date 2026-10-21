import { redirect } from '@sveltejs/kit';

export function load({ locals, url }) {
  if (!locals.viewer) redirect(303, `/login?next=${encodeURIComponent(url.pathname)}`);
  return { viewer: locals.viewer };
}
