import { fail, redirect } from '@sveltejs/kit';
import type { PersonRemovalMode } from '@logitland/contracts';
import { env } from 'cloudflare:workers';
import { PeopleError, personStatus, removePerson, type Person } from '#lib/server/people.js';
import { previewOf } from '#lib/server/public-relay.js';
import { readPerson } from '#lib/server/session.js';

const SIGN_IN = `/login?next=${encodeURIComponent('/mirror/remove')}`;

type Who = (Person & { username: string; demo: boolean }) | null;

/** Whoever signed in most recently with Discord: someone who came only to remove their messages (no owner account), or an owner. */
async function whoIs(locals: App.Locals, cookies: import('@sveltejs/kit').Cookies): Promise<Who> {
  const person = env.SESSION_SECRET ? await readPerson(cookies, env.SESSION_SECRET) : null;
  if (person) return { discord_user_id: person.discord_user_id, username: person.username, demo: false };
  return locals.viewer && { discord_user_id: locals.viewer.discord_user_id, username: locals.viewer.username, demo: locals.viewer.demo };
}

export async function load({ locals, cookies, url }) {
  const viewer = await whoIs(locals, cookies);
  // Fixtures mode always has an example viewer; ?preview=signed-out shows what a visitor gets.
  if (!viewer || previewOf(url) === 'signed-out') redirect(303, SIGN_IN);
  try {
    return { username: viewer.username, demo: viewer.demo, status: await personStatus(viewer, previewOf(url)), problem: null, preview: previewOf(url) };
  } catch (e) {
    if (!(e instanceof PeopleError)) throw e;
    return { username: viewer.username, demo: viewer.demo, status: null, problem: e.message, preview: previewOf(url) };
  }
}

async function act(mode: PersonRemovalMode, viewer: Who, preview: string | null) {
  if (!viewer) redirect(303, SIGN_IN);
  try {
    const r = await removePerson(viewer, mode, preview);
    return {
      done: mode,
      removed: r.removed_messages,
      roleRemoved: r.role_removed,
      agreed: r.consent.agreed,
      revokedAt: r.consent.revoked_at,
      remaining: r.consent.mirrored_messages,
    };
  } catch (e) {
    if (!(e instanceof PeopleError)) throw e;
    return fail(e.status, { error: e.message, mode });
  }
}

export const actions = {
  remove: async ({ locals, cookies, url }) => act('remove_messages', await whoIs(locals, cookies), previewOf(url)),
  leave: async ({ locals, cookies, url }) => act('leave', await whoIs(locals, cookies), previewOf(url)),
};
