import { isRedirect } from '@sveltejs/kit';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { nextPath, OAUTH_COOKIE } from '../src/lib/server/discord.ts';
import { SESSION_COOKIE } from '../src/lib/server/session.ts';
import { GET as callback } from '../src/routes/auth/callback/+server.ts';
import { GET as authorize } from '../src/routes/auth/discord/+server.ts';
import { load } from '../src/routes/sign-in/+page.server.ts';
import { env } from './cloudflare-workers.ts';

const ORIGIN = 'https://logit.land';
const OWNER = { id: 'own_pat', username: 'pat' };

describe('the post-sign-in destination', () => {
  it.each([
    null,
    '',
    'agents',
    '../agents',
    '?next=/agents',
    '#agents',
    'https://outside.example/agents',
    'https://logit.land/agents',
    'javascript:alert(1)',
    '//outside.example/agents',
    '///outside.example/agents',
    '/\\outside.example/agents',
    '/\\outside.example\\agents',
    '/\t/outside.example/agents',
    '/\n/outside.example/agents',
    '/\r/outside.example/agents',
    '/\\[invalid',
    '/agents/..//outside.example/agents',
    '/agents/%2e%2e//outside.example/agents',
    '/agents/..\\/outside.example/agents',
    '/.//outside.example/agents',
  ])('falls back for %j', (next) => {
    expect(nextPath(next)).toBe('/agents');
  });

  it.each([
    ['/', '/'],
    ['/agents', '/agents'],
    ['/agents?sort=name#list', '/agents?sort=name#list'],
    [
      '/oauth/authorize?redirect_uri=https%3A%2F%2Fclient.example%2Fcallback&state=xyz',
      '/oauth/authorize?redirect_uri=https%3A%2F%2Fclient.example%2Fcallback&state=xyz',
    ],
    ['/agents/../settings?tab=profile#name', '/settings?tab=profile#name'],
    ['/agents/%2e%2e/settings', '/settings'],
    ['/agents\\settings', '/agents/settings'],
    ['/agents//settings', '/agents//settings'],
    ['/agents/my agent', '/agents/my%20agent'],
    ['/agents\t/settings', '/agents/settings'],
    ['/%2f%2foutside.example', '/%2f%2foutside.example'],
    ['/%5coutside.example', '/%5coutside.example'],
  ])('normalizes %j to a reusable same-origin path', (next, expected) => {
    const path = nextPath(next);
    expect(path).toBe(expected);
    expect(nextPath(path)).toBe(path);
    for (const origin of [ORIGIN, 'https://staging.logit.land', 'http://localhost:5174']) {
      expect(new URL(path, origin).origin).toBe(origin);
    }
  });
});

function cookiesKeeping(oauth?: string) {
  const values = new Map(oauth ? [[OAUTH_COOKIE, oauth]] : []);
  return {
    get: (name: string) => values.get(name),
    set: vi.fn((name: string, value: string) => values.set(name, value)),
    delete: vi.fn((name: string) => values.delete(name)),
  };
}

async function destination(run: () => unknown): Promise<string> {
  try {
    await run();
  } catch (err) {
    if (isRedirect(err)) {
      expect(err.status).toBe(303);
      return err.location;
    }
    throw err;
  }
  throw new Error('expected a redirect');
}

describe.each([
  ['/\\outside.example/agents', '/agents'],
  ['/agents/..//outside.example/agents', '/agents'],
  ['/agents/../settings?tab=profile#name', '/settings?tab=profile#name'],
  [
    '/oauth/authorize?client_id=client&redirect_uri=https%3A%2F%2Fclient.example%2Fcallback&state=xyz',
    '/oauth/authorize?client_id=client&redirect_uri=https%3A%2F%2Fclient.example%2Fcallback&state=xyz',
  ],
])('signing in with next=%j', (next, expected) => {
  beforeEach(() => {
    env.DISCORD_URL = 'https://discord.com';
    env.DISCORD_CLIENT_ID = 'test-client';
    env.DISCORD_CLIENT_SECRET = 'test-client-secret';
    env.SESSION_SECRET = 'test-session-secret';
    env.INTERNAL_TOKEN = 'test-internal-token';
    env.RELAY = { fetch: async () => Response.json({ owner: OWNER }) } as unknown as Env['RELAY'];
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(Response.json({ access_token: 'test-token' }))
        .mockResolvedValueOnce(Response.json({ id: '42', username: OWNER.username, avatar: null })),
    );
  });

  afterEach(() => vi.unstubAllGlobals());

  it('redirects an already-signed-in owner safely', async () => {
    const url = new URL(`/sign-in?${new URLSearchParams({ next })}`, ORIGIN);
    expect(await destination(() => load({ locals: { owner: OWNER }, url } as never))).toBe(expected);
  });

  it('keeps a safe destination through the OAuth cookie and successful callback', async () => {
    const cookies = cookiesKeeping();
    const url = new URL(`/auth/discord?${new URLSearchParams({ next })}`, ORIGIN);
    const discord = new URL(await destination(() => authorize({ url, cookies } as never)));
    const state = discord.searchParams.get('state')!;
    expect(discord.origin).toBe(env.DISCORD_URL);
    expect(state).toBeTruthy();
    expect(cookies.get(OAUTH_COOKIE)).toBe(`${state} ${expected}`);

    const back = new URL(`/auth/callback?${new URLSearchParams({ code: 'code', state })}`, ORIGIN);
    expect(await destination(() => callback({ url: back, cookies, locals: {} } as never))).toBe(expected);
    expect(cookies.get(OAUTH_COOKIE)).toBeUndefined();
    expect(cookies.get(SESSION_COOKIE)).toBeTruthy();
  });

  it('revalidates an existing OAuth cookie before the successful callback redirects', async () => {
    const cookies = cookiesKeeping(`state ${next}`);
    const url = new URL('/auth/callback?code=code&state=state', ORIGIN);
    expect(await destination(() => callback({ url, cookies, locals: {} } as never))).toBe(expected);
    expect(cookies.get(OAUTH_COOKIE)).toBeUndefined();
    expect(cookies.get(SESSION_COOKIE)).toBeTruthy();
  });

  it('uses a safe destination when retrying a declined or invalid callback', async () => {
    const cookies = cookiesKeeping(`state ${next}`);
    const url = new URL('/auth/callback?state=wrong', ORIGIN);
    expect(await destination(() => callback({ url, cookies, locals: {} } as never))).toBe(`/sign-in?next=${encodeURIComponent(expected)}`);
    expect(cookies.get(OAUTH_COOKIE)).toBeUndefined();
    expect(fetch).not.toHaveBeenCalled();
  });
});
