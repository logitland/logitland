import type { Handle } from '@sveltejs/kit/hooks';
import { env } from 'cloudflare:workers';
import { DEMO_OWNER } from '#lib/fixtures/community.js';
import { configProblems } from '#lib/server/config-check.js';
import { dataSource } from '#lib/server/relay.js';
import { isPublicPath, unavailable, withSecurityHeaders } from '#lib/server/security-headers.js';
import { readSession } from '#lib/server/session.js';

let reported = false;

export const handle: Handle = async ({ event, resolve }) => {
  const problems = configProblems(env);
  if (problems.length) {
    if (!reported) {
      reported = true;
      console.error(JSON.stringify({ event: 'frontend.config_invalid', problems }));
    }
    return unavailable();
  }
  const session = env.SESSION_SECRET ? await readSession(event.cookies, env.SESSION_SECRET) : null;
  if (session) {
    event.locals.viewer = {
      owner_id: session.owner_id,
      discord_user_id: session.discord_user_id,
      username: session.username,
      is_admin: session.is_admin,
      demo: false,
    };
  } else if (dataSource() === 'fixtures') {
    // Fixtures mode: browse as the example owner. Admin pages are open too, so the whole console can be reviewed.
    event.locals.viewer = { ...DEMO_OWNER, is_admin: true, demo: true };
  } else {
    event.locals.viewer = null;
  }
  const personal = Boolean(event.locals.viewer && !event.locals.viewer.demo) || !isPublicPath(event.url.pathname);
  return withSecurityHeaders(await resolve(event), { personal });
};
