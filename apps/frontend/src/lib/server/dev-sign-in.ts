import { env } from 'cloudflare:workers';
import { dataSource } from '#lib/server/relay.js';

const LOCAL = /^(localhost|127\.0\.0\.1|\[::1\])$|\.(localhost|test)$/;

/** Local development against a fake Discord (pnpm dev:full): sign in as any Discord user ID without OAuth. Never on a public URL. */
export function devSignInAllowed(): boolean {
  if (env.DEV_SIGN_IN !== 'true' || dataSource() !== 'relay' || !env.SESSION_SECRET) return false;
  try {
    return LOCAL.test(new URL(env.PUBLIC_URL).hostname);
  } catch {
    return false;
  }
}
