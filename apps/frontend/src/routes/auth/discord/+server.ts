import { redirect } from '@sveltejs/kit';
import { env } from 'cloudflare:workers';
import { startAuthorization } from '#lib/server/discord-oauth.js';
import { safeNext } from '#lib/server/safe-next.js';
import { sign } from '#lib/server/session.js';

export async function GET({ cookies, url }) {
  if (!env.DISCORD_CLIENT_ID || !env.SESSION_SECRET) redirect(303, '/login');
  const next = safeNext(url.searchParams.get('next'));
  const start = await startAuthorization(env.DISCORD_CLIENT_ID, `${env.PUBLIC_URL}/auth/callback`);
  // State and verifier live in a short-lived signed cookie and are used once.
  cookies.set('ll_oauth', await sign(env.SESSION_SECRET, { state: start.state, verifier: start.verifier, next }), {
    path: '/auth',
    httpOnly: true,
    sameSite: 'lax',
    secure: url.protocol === 'https:',
    maxAge: 600,
  });
  redirect(302, start.url, { external: ['https://discord.com'] });
}
