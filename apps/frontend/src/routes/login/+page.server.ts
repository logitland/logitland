import { env } from 'cloudflare:workers';
import { dataSource } from '#lib/server/relay.js';
import { safeNext } from '#lib/server/safe-next.js';

export function load({ url }) {
  return {
    discordConfigured: Boolean(env.DISCORD_CLIENT_ID && env.SESSION_SECRET),
    fixtures: dataSource() === 'fixtures',
    next: safeNext(url.searchParams.get('next')),
    signedOut: url.searchParams.has('signed_out'),
  };
}
