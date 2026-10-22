import { error } from '@sveltejs/kit';
import { env } from 'cloudflare:workers';

// Sign in with Discord: OAuth2's authorization code flow with the `identify` scope, which is all the relay needs (the
// person's Discord ID and username). DISCORD_URL points it at the fake Discord in development.

/** Holds the OAuth state and where to go after signing in, between leaving for Discord and coming back. */
export const OAUTH_COOKIE = 'oauth';

/** Where to go after signing in: `next` if it is a path on this site, so it can't send the person elsewhere. */
export const nextPath = (next: string | null) => (next && /^\/(?!\/)/.test(next) ? next : '/agents');

const callbackUrl = (origin: string) => `${origin}/auth/callback`;

export function authorizeUrl(origin: string, state: string): string {
  const query = new URLSearchParams({
    client_id: env.DISCORD_CLIENT_ID,
    response_type: 'code',
    scope: 'identify',
    redirect_uri: callbackUrl(origin),
    state,
  });
  return `${env.DISCORD_URL}/oauth2/authorize?${query}`;
}

/** Trades the callback's code for the person it signed in. `avatar` is Discord's image hash, null without a custom one. */
export async function signedInUser(origin: string, code: string): Promise<{ id: string; username: string; avatar: string | null }> {
  const token = await fetch(`${env.DISCORD_URL}/api/v10/oauth2/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: callbackUrl(origin),
      client_id: env.DISCORD_CLIENT_ID,
      client_secret: env.DISCORD_CLIENT_SECRET,
    }),
  });
  if (!token.ok) error(400, 'Discord didn’t accept the sign-in. Try again.');
  const { access_token } = (await token.json()) as { access_token: string };
  const me = await fetch(`${env.DISCORD_URL}/api/v10/users/@me`, { headers: { authorization: `Bearer ${access_token}` } });
  if (!me.ok) error(502, 'Discord didn’t say who signed in. Try again.');
  return (await me.json()) as { id: string; username: string; avatar: string | null };
}
