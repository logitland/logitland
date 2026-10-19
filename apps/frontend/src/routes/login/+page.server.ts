import { env } from 'cloudflare:workers';
import { devSignInAllowed } from '#lib/server/dev-sign-in.js';
import { dataSource } from '#lib/server/relay.js';
import { safeNext } from '#lib/server/safe-next.js';
import { isRemovalOnly } from '#lib/server/session.js';

export function load({ url }) {
  const next = safeNext(url.searchParams.get('next'));
  return {
    removal: isRemovalOnly(next),
    cancelled: url.searchParams.has('cancelled'),
    discordConfigured: Boolean(env.DISCORD_CLIENT_ID && env.SESSION_SECRET),
    fixtures: dataSource() === 'fixtures',
    devSignIn: devSignInAllowed(),
    next,
    signedOut: url.searchParams.has('signed_out'),
  };
}
