// Sign in with Discord against the fake, the way the web app does it.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DiscordFake } from '../src/fake.ts';
import { seedDevCommunity } from '../src/seed.ts';

let fake: DiscordFake;
beforeEach(async () => {
  fake = await DiscordFake.start({ port: 0 });
});
afterEach(() => fake.close());

const REDIRECT = 'http://localhost:5174/auth/callback';

async function authorize(query: Record<string, string>) {
  return fetch(`${fake.url}/oauth2/authorize?${new URLSearchParams({ response_type: 'code', redirect_uri: REDIRECT, ...query })}`, { redirect: 'manual' });
}

const exchange = (code: string, redirectUri = REDIRECT) =>
  fetch(`${fake.apiBase}/oauth2/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: redirectUri }),
  });

describe('OAuth2', () => {
  it('signs a picked person in: code, token, then /users/@me', async () => {
    const { adminId } = seedDevCommunity(fake);
    const back = new URL((await authorize({ login_as: adminId, state: 's1' })).headers.get('location')!);
    expect(back.origin + back.pathname).toBe(REDIRECT);
    expect(back.searchParams.get('state')).toBe('s1');

    const token = (await (await exchange(back.searchParams.get('code')!)).json()) as { access_token: string; token_type: string };
    expect(token.token_type).toBe('Bearer');
    const me = await fetch(`${fake.apiBase}/users/@me`, { headers: { authorization: `Bearer ${token.access_token}` } });
    expect(await me.json()).toMatchObject({ id: adminId, username: 'luna-admin' });
  });

  it('lists the people, not the bot, on the authorize page', async () => {
    seedDevCommunity(fake);
    const page = await (await authorize({})).text();
    expect(page).toContain('Luna (admin)');
    expect(page).not.toContain(fake.application.name);
  });

  it('refuses a code twice, or for another redirect', async () => {
    const { adminId } = seedDevCommunity(fake);
    const code = () => authorize({ login_as: adminId }).then((r) => new URL(r.headers.get('location')!).searchParams.get('code')!);
    expect((await exchange(await code(), 'http://elsewhere/cb')).status).toBe(400);
    const once = await code();
    expect((await exchange(once)).status).toBe(200);
    expect((await exchange(once)).status).toBe(400);
  });
});
