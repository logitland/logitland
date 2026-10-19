import { error, redirect } from '@sveltejs/kit';
import { env } from 'cloudflare:workers';
import { finishAuthorization } from '#lib/server/discord-oauth.js';
import { relay } from '#lib/server/relay.js';
import { safeNext } from '#lib/server/safe-next.js';
import { unsign, writeSession } from '#lib/server/session.js';

export async function GET({ cookies, url }) {
  if (!env.DISCORD_CLIENT_ID || !env.DISCORD_CLIENT_SECRET || !env.SESSION_SECRET) error(404);
  const saved = await unsign<{ state: string; verifier: string; next: string }>(env.SESSION_SECRET, cookies.get('ll_oauth'));
  cookies.delete('ll_oauth', { path: '/auth' });
  const code = url.searchParams.get('code');
  if (!saved || !code || url.searchParams.get('state') !== saved.state) error(400, 'The sign-in link expired or was already used. Start again.');

  const user = await finishAuthorization({ clientId: env.DISCORD_CLIENT_ID, clientSecret: env.DISCORD_CLIENT_SECRET, redirectUri: `${env.PUBLIC_URL}/auth/callback`, code, verifier: saved.verifier });
  const client = relay();
  if (!client) error(503, 'Sign-in needs DATA_SOURCE set to "relay".');
  const { owner, is_admin } = await client.upsertOwner(user.id, user.global_name ?? user.username);
  await writeSession(cookies, env.SESSION_SECRET, { owner_id: owner.id, discord_user_id: owner.discord_user_id, username: owner.username, is_admin }, url.protocol === 'https:');
  redirect(303, safeNext(saved.next));
}
