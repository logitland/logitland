// Discord's OAuth2 authorization code flow, as a web app's "Sign in with Discord" uses it (scope `identify`). The
// authorize page lists the people in the fake (not bots) and signs in as whoever is picked; `login_as` skips the page.
// The code exchange and `GET /users/@me` with the user's token answer as Discord does. Client credentials aren't checked.

import { randomBytes } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { User } from './model.ts';
import type { DiscordFake } from './fake.ts';

/** Discord's access tokens last a week. */
const TOKEN_SECONDS = 604_800;

const escape = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

export class OAuth {
  private readonly codes = new Map<string, { userId: string; redirectUri: string }>();
  private readonly tokens = new Map<string, string>();
  private readonly fake: DiscordFake;

  constructor(fake: DiscordFake) {
    this.fake = fake;
  }

  /** Answers the request if it belongs to OAuth2; false when it doesn't. */
  async handle(req: IncomingMessage, res: ServerResponse, url: URL): Promise<boolean> {
    if (req.method === 'GET' && url.pathname === '/oauth2/authorize') return this.authorize(res, url);
    if (req.method === 'POST' && /^\/api(\/v(9|10))?\/oauth2\/token$/.test(url.pathname)) return this.exchange(req, res);
    const bearer = /^Bearer (.+)$/.exec(req.headers.authorization ?? '')?.[1];
    if (req.method === 'GET' && bearer && /^\/api(\/v(9|10))?\/users\/@me$/.test(url.pathname)) return this.me(res, bearer);
    return false;
  }

  private people(): User[] {
    return [...this.fake.world.users.values()].filter((u) => !u.bot);
  }

  private authorize(res: ServerResponse, url: URL): true {
    const redirectUri = url.searchParams.get('redirect_uri');
    if (!redirectUri || url.searchParams.get('response_type') !== 'code') {
      res.writeHead(400, { 'content-type': 'text/plain' }).end('Needs redirect_uri and response_type=code');
      return true;
    }
    const back = (userId: string) => {
      const code = randomBytes(16).toString('base64url');
      this.codes.set(code, { userId, redirectUri });
      const target = new URL(redirectUri);
      target.searchParams.set('code', code);
      const state = url.searchParams.get('state');
      if (state) target.searchParams.set('state', state);
      return target.href;
    };
    const as = url.searchParams.get('login_as');
    if (as) {
      res.writeHead(302, { location: back(as) }).end();
      return true;
    }
    const links = this.people()
      .map((u) => `<li><a href="${escape(back(u.id))}">${escape(u.global_name ?? u.username)}</a> <small>@${escape(u.username)}</small></li>`)
      .join('');
    res
      .writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
      .end(`<!doctype html><title>Sign in · fake Discord</title><h1>Sign in to the fake Discord as</h1><ul>${links}</ul>`);
    return true;
  }

  private async exchange(req: IncomingMessage, res: ServerResponse): Promise<true> {
    let raw = '';
    for await (const chunk of req) raw += String(chunk);
    const form = new URLSearchParams(raw);
    const grant = this.codes.get(form.get('code') ?? '');
    const json = (status: number, body: unknown) => res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(body));
    if (form.get('grant_type') !== 'authorization_code' || !grant || grant.redirectUri !== form.get('redirect_uri')) {
      json(400, { error: 'invalid_grant', error_description: 'Invalid "code" in request.' });
      return true;
    }
    this.codes.delete(form.get('code')!);
    const token = randomBytes(24).toString('base64url');
    this.tokens.set(token, grant.userId);
    json(200, { access_token: token, token_type: 'Bearer', expires_in: TOKEN_SECONDS, scope: 'identify' });
    return true;
  }

  private me(res: ServerResponse, token: string): true {
    const user = this.fake.world.users.get(this.tokens.get(token) ?? '');
    if (!user) res.writeHead(401, { 'content-type': 'application/json' }).end(JSON.stringify({ message: '401: Unauthorized', code: 0 }));
    else res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(user));
    return true;
  }
}
