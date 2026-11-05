import type { MiddlewareHandler } from 'hono';
import type { Relay } from '../context';
import { RelayError, forbidden } from '../errors';
import { handleMcp } from '../mcp/server';
import { loganTools } from '../mcp/logan-tools';
import { enforce } from '../services/limits';
import { loadCaller } from '../services/logan/access';
import { SCOPE, authenticate, exchange, loganUrls, registerClient, revoke } from '../services/logan/oauth';
import { bearer, body, formFields, type Env, type RegisterRoutes } from './shared';

// The Logan admin MCP (contracts LOGAN_API): a person's own MCP client has Logan, the relay's bot, act in the server within that
// person's Discord permissions. OAuth 2.1 for MCP under its own issuer; the authorization endpoint is the dashboard's. Paths sit
// under /mcp, /oauth2 and /.well-known/oauth-*, which go to the relay on a shared hostname too.

const INSTRUCTIONS = [
  'Logan is the Logitland server’s Discord bot. Through this server you have Logan perform Discord operations in that server, as yourself: only what your own roles allow, checked on every call.',
  'Find an operation with `search_operations` (plain words work), read what it takes with `describe_operation`, then run it with `call_operation`.',
  'Destructive operations (deletes, kicks, bans, timeouts, bulk changes) answer status pending: confirm them on Logan’s message in the staff log channel within 10 minutes, then check `request_status`.',
  'Every change is audited and posted in the staff log channel under your name. Give a `reason`.',
].join(' ');

/** Calls per person per minute: plenty for a person directing an assistant, and a ceiling for one that loops. */
const CALLS_PER_MINUTE = 60;

/** The person behind the Bearer token. A 401 points MCP clients at the protected-resource metadata, where sign-in starts. */
function personAuth(relay: Relay): MiddlewareHandler<Env> {
  return async (c, next) => {
    try {
      const token = bearer(c);
      if (!token) throw new RelayError(401, 'unauthorized', 'Sign in with Discord: add this server to your MCP client and follow its sign-in.');
      c.set('ownerId', await authenticate(relay, token));
    } catch (err) {
      if (err instanceof RelayError && err.status === 401)
        c.header('www-authenticate', `Bearer resource_metadata="${loganUrls(relay).resourceMetadata}", scope="${SCOPE}"`);
      throw err;
    }
    await next();
  };
}

export const register: RegisterRoutes = (app, relay) => {
  const urls = loganUrls(relay);
  const docs = { 'cache-control': 'public, max-age=300' };

  app.get('/.well-known/oauth-protected-resource/mcp/admin', (c) =>
    c.json(
      {
        resource: urls.resource,
        authorization_servers: [urls.issuer],
        scopes_supported: [SCOPE],
        bearer_methods_supported: ['header'],
        resource_name: 'Logan admin MCP',
        resource_documentation: `${relay.config.dashboardUrl}/admin/logan`,
      },
      200,
      docs,
    ),
  );

  app.get('/.well-known/oauth-authorization-server/oauth2/admin', (c) =>
    c.json(
      {
        issuer: urls.issuer,
        authorization_endpoint: urls.authorize,
        token_endpoint: `${urls.issuer}/token`,
        registration_endpoint: `${urls.issuer}/register`,
        revocation_endpoint: `${urls.issuer}/revoke`,
        response_types_supported: ['code'],
        grant_types_supported: ['authorization_code', 'refresh_token'],
        code_challenge_methods_supported: ['S256'],
        token_endpoint_auth_methods_supported: ['none'],
        revocation_endpoint_auth_methods_supported: ['none'],
        scopes_supported: [SCOPE],
        authorization_response_iss_parameter_supported: true,
      },
      200,
      docs,
    ),
  );

  app.post('/oauth2/admin/register', async (c) => {
    c.header('cache-control', 'no-store');
    return c.json(await registerClient(relay, await body(c), c.get('client')), 201);
  });

  app.post('/oauth2/admin/token', async (c) => {
    c.header('cache-control', 'no-store');
    return c.json(await exchange(relay, await formFields(c)));
  });

  app.post('/oauth2/admin/revoke', async (c) => {
    const token = (await formFields(c)).token;
    if (token) await revoke(relay, token);
    return c.body(null, 200);
  });

  const origin = new URL(relay.config.publicUrl).origin;
  app.post('/mcp/admin', personAuth(relay), async (c) => {
    // The spec asks servers to refuse other sites' pages (DNS rebinding); MCP clients send no Origin.
    const from = c.req.header('origin');
    if (from && from !== origin) throw forbidden('MCP requests from web pages on other sites are refused.');
    const ownerId = c.get('ownerId');
    await enforce(
      relay,
      [{ key: `logan:${ownerId}:m`, limit: CALLS_PER_MINUTE, windowSeconds: 60 }],
      `Logan takes ${CALLS_PER_MINUTE} calls a minute from one person.`,
    );
    // Who they are and what they may do, from Discord, on every request: a role taken away a moment ago already counts.
    const caller = await loadCaller(relay, ownerId);
    return handleMcp({ name: 'logan', version: '0.1.0', instructions: INSTRUCTIONS, tools: loganTools(relay, caller) }, c.req.raw);
  });
  app.all('/mcp/admin', () => new Response(null, { status: 405, headers: { allow: 'POST' } }));
};
