import { error, redirect } from '@sveltejs/kit';

export function load({ locals, url }) {
  if (!locals.viewer) redirect(303, `/login?next=${encodeURIComponent(url.pathname)}`);
  // Signing in never makes someone an admin by itself: the relay decides, by checking the Discord user ID against ADMIN_DISCORD_IDS on every admin request.
  if (!locals.viewer.is_admin) error(403, 'This console is for relay admins.');
  return { viewer: locals.viewer };
}
