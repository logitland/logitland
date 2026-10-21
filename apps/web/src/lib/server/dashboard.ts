import type { AdminStanding } from '@logitland/contracts';
import { redirect, type ServerLoadEvent } from '@sveltejs/kit';
import type { Person } from '#lib/session.js';
import { relay } from './relay.js';

/**
 * What every dashboard page needs: who is signed in, and their admin standing, which the relay reads from Discord.
 * Without a session, the page sends the person to sign in and back.
 */
export async function signedIn(event: ServerLoadEvent): Promise<{ person: Person; standing: AdminStanding }> {
  // Reading the path makes every navigation re-run the dashboards' layouts, so standing taken away applies on the next page.
  const path = event.url.pathname;
  const owner = event.locals.owner;
  if (!owner) redirect(303, `/sign-in?next=${encodeURIComponent(path)}`);
  const standing = await relay<AdminStanding>(event, `/internal/owners/${owner.id}/admin`);
  return { person: { id: owner.id, name: owner.username, handle: owner.username }, standing };
}
