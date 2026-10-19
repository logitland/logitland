import { error, redirect } from '@sveltejs/kit';
import { env } from 'cloudflare:workers';
import { finishAuthorization } from '#lib/server/discord-oauth.js';
import { relay } from '#lib/server/relay.js';
import { safeNext } from '#lib/server/safe-next.js';
import { isRemovalOnly, unsign, writePerson, writeSession } from '#lib/server/session.js';

export async function GET({ cookies, url }) {
  if (!env.DISCORD_CLIENT_ID || !env.DISCORD_CLIENT_SECRET || !env.SESSION_SECRET) error(404);
  const saved = await unsign<{ state: string; verifier: string; next: string }>(env.SESSION_SECRET, 'oauth', cookies.get('ll_oauth'));
  cookies.delete('ll_oauth', { path: '/auth' });
  const code = url.searchParams.get('code');
  if (!saved || !code || url.searchParams.get('state') !== saved.state) error(400, 'The sign-in link expired or was already used. Start again.');

  const user = await finishAuthorization({
    clientId: env.DISCORD_CLIENT_ID,
    clientSecret: env.DISCORD_CLIENT_SECRET,
    redirectUri: `${env.PUBLIC_URL}/auth/callback`,
    code,
    verifier: saved.verifier,
  });
  const next = safeNext(saved.next);
  const username = user.global_name ?? user.username;
  const secure = url.protocol === 'https:';
  // Someone who only came to remove their messages gets no owner account, just a short session saying who they are.
  if (isRemovalOnly(next)) {
    await writePerson(cookies, env.SESSION_SECRET, { discord_user_id: user.id, username }, secure);
    redirect(303, next);
  }
  const client = relay();
  if (!client) error(503, 'Sign-in needs DATA_SOURCE set to "relay".');
  const { owner, is_admin } = await client.upsertOwner(user.id, username);
  await writeSession(cookies, env.SESSION_SECRET, { owner_id: owner.id, discord_user_id: owner.discord_user_id, username: owner.username, is_admin }, secure);
  redirect(303, next);
}
