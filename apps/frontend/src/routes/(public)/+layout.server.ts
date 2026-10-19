import { env } from 'cloudflare:workers';
import { previewOf } from '#lib/server/public-relay.js';

export function load({ locals, url }) {
  const viewer = previewOf(url) === 'signed-out' ? null : locals.viewer;
  return {
    // Only what the header draws; the session's IDs stay on the server.
    viewer: viewer ? { username: viewer.username, demo: viewer.demo } : null,
    authMd: `${env.RELAY_PUBLIC_URL}/auth.md`,
  };
}
