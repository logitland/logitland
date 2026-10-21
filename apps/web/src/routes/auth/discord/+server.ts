import { redirect } from '@sveltejs/kit';
import { OAUTH_COOKIE, authorizeUrl, nextPath } from '#lib/server/discord.js';

const OAUTH_SECONDS = 600;

// Sends the person to Discord. The state, and where to go afterwards, wait in a short cookie for the callback.
export const GET = ({ url, cookies }) => {
  const next = nextPath(url.searchParams.get('next'));
  const state = crypto.randomUUID();
  cookies.set(OAUTH_COOKIE, `${state} ${next}`, { path: '/auth', httpOnly: true, sameSite: 'lax', maxAge: OAUTH_SECONDS });
  redirect(303, authorizeUrl(url.origin, state), { external: true });
};
