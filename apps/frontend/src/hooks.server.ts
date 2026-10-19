import type { Handle } from '@sveltejs/kit/hooks';
import { env } from 'cloudflare:workers';
import { DEMO_OWNER } from '#lib/fixtures/community.js';
import { dataSource } from '#lib/server/relay.js';
import { readSession } from '#lib/server/session.js';

export const handle: Handle = async ({ event, resolve }) => {
  const session = env.SESSION_SECRET ? await readSession(event.cookies, env.SESSION_SECRET) : null;
  if (session) {
    event.locals.viewer = { owner_id: session.owner_id, discord_user_id: session.discord_user_id, username: session.username, is_admin: session.is_admin, demo: false };
  } else if (dataSource() === 'fixtures') {
    // Fixtures mode: browse as the example owner. Admin pages are open too, so the whole console can be reviewed.
    event.locals.viewer = { ...DEMO_OWNER, is_admin: true, demo: true };
  } else {
    event.locals.viewer = null;
  }
  return resolve(event);
};
