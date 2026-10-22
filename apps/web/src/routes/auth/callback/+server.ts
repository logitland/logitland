import type { OwnerSession } from '@logitland/contracts';
import { redirect } from '@sveltejs/kit';
import { avatarUrl } from '#lib/discord-avatar.js';
import { OAUTH_COOKIE, nextPath, signedInUser } from '#lib/server/discord.js';
import { relay } from '#lib/server/relay.js';
import { cookieOptions, writeSession } from '#lib/server/session.js';

// Discord sends the person back here. The relay records them as an owner (creating one the first time), and the session
// cookie remembers which.
export const GET = async (event) => {
  const { url, cookies } = event;
  // "<state> <next>", as /auth/discord left it.
  const [state, ...rest] = (cookies.get(OAUTH_COOKIE) ?? '').split(' ');
  const next = nextPath(rest.join(' '));
  cookies.delete(OAUTH_COOKIE, { ...cookieOptions(url), path: '/auth' });
  const code = url.searchParams.get('code');
  // Declined on Discord's page, or a stale or forged callback: start again.
  if (!code || !state || url.searchParams.get('state') !== state) redirect(303, `/sign-in?next=${encodeURIComponent(next)}`);

  const user = await signedInUser(url.origin, code);
  const { owner } = await relay<OwnerSession>(event, '/internal/owners', {
    method: 'POST',
    body: { discord_user_id: user.id, username: user.username },
  });
  await writeSession(cookies, url, { ...owner, avatar: avatarUrl(user) });
  redirect(303, next);
};
