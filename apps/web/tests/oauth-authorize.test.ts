import { isHttpError, isRedirect } from '@sveltejs/kit';
import { describe, expect, it } from 'vitest';
import { actions, load } from '../src/routes/oauth/authorize/+page.server.ts';
import { env } from './cloudflare-workers.ts';

// The Logan admin MCP's consent page: it keeps the MCP client's request through Discord sign-in, and hands the person's
// answer to the relay, which decides where the browser goes next.

const REQUEST = {
  response_type: 'code',
  client_id: 'lgc_01JABCDEFGHJKMNPQRSTVWXYZ0',
  redirect_uri: 'http://localhost:33418/callback',
  code_challenge: 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM',
  code_challenge_method: 'S256',
  state: 'xyz',
};
const PAGE = new URL(`https://logit.land/oauth/authorize?${new URLSearchParams(REQUEST)}`);
const PAT = { id: 'own_pat', username: 'pat' };

/** The relay behind the service binding: answers `reply` and keeps what it was asked. */
function relayAnswering(reply: unknown) {
  const asked: { path: string; body: unknown }[] = [];
  env.INTERNAL_TOKEN = 'test-internal-token';
  env.RELAY = {
    fetch: async (input: RequestInfo | URL, init?: RequestInit) => {
      asked.push({ path: new URL(String(input)).pathname, body: JSON.parse(String(init?.body)) });
      return Response.json(reply);
    },
  } as unknown as Env['RELAY'];
  return asked;
}

async function thrown(run: () => unknown): Promise<unknown> {
  try {
    await run();
  } catch (err) {
    return err;
  }
  throw new Error('expected a throw');
}

describe('the consent page', () => {
  it('sends a signed-out person to sign in, and back to the same request', async () => {
    const err = await thrown(() => load({ locals: {}, url: PAGE } as never));
    expect(isRedirect(err) && err.location).toBe(`/sign-in?next=${encodeURIComponent(PAGE.pathname + PAGE.search)}`);
  });

  it('shows the client the relay named, and refuses a request missing its PKCE challenge', async () => {
    const asked = relayAnswering({ client_name: 'Claude Code', allowed: true });
    expect(await load({ locals: { owner: PAT }, url: PAGE } as never)).toMatchObject({ consent: { client_name: 'Claude Code', allowed: true } });
    expect(asked).toEqual([{ path: '/internal/owners/own_pat/logan/consent', body: REQUEST }]);

    const partial = new URL(PAGE);
    partial.searchParams.delete('code_challenge');
    const err = await thrown(() => load({ locals: { owner: PAT }, url: partial } as never));
    expect(isHttpError(err) && err.status).toBe(400);
  });

  it('hands the answer to the relay and sends the browser where the relay says', async () => {
    const to = `${REQUEST.redirect_uri}?code=llc_abc&state=xyz`;
    const asked = relayAnswering({ redirect_to: to });
    const form = new FormData();
    for (const [name, value] of Object.entries(REQUEST)) form.set(name, value);
    const err = await thrown(() => actions.allow({ locals: { owner: PAT }, request: new Request(PAGE, { method: 'POST', body: form }) } as never));
    expect(isRedirect(err) && err.location).toBe(to);
    expect(asked).toEqual([{ path: '/internal/owners/own_pat/logan/authorize', body: { ...REQUEST, decision: 'allow' } }]);
  });
});
