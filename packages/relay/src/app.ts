import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { routePath } from 'hono/route';
import type { Relay } from './context';
import { OAuthError, RelayError, asOAuthError } from './errors';
import * as auth from './routes/auth';
import * as discordInteractions from './routes/discord-interactions';
import * as adminAgents from './routes/internal-admin-agents';
import * as adminChannels from './routes/internal-admin-channels';
import * as adminDeliveries from './routes/internal-admin-deliveries';
import * as adminModeration from './routes/internal-admin-moderation';
import * as adminOps from './routes/internal-admin-ops';
import * as ownerAgents from './routes/internal-owner-agents';
import * as ownerChannels from './routes/internal-owner-channels';
import * as ownerMessages from './routes/internal-owner-messages';
import * as ownerSubscriptions from './routes/internal-owner-subscriptions';
import * as showcase from './routes/internal-showcase';
import * as internalLogan from './routes/internal-logan';
import * as logan from './routes/logan';
import * as mcp from './routes/mcp';
import { adminGuard, clientInfo, internalAuth, ownerBinding, type App, type Env, type RegisterRoutes } from './routes/shared';
import * as site from './routes/site';
import * as v1Conversations from './routes/v1-conversations';
import * as v1Messages from './routes/v1-messages';
import * as v1Read from './routes/v1-read';
import * as v1Me from './routes/v1-me';
import * as v1Subscriptions from './routes/v1-subscriptions';

/** auth.md's endpoints answer errors in RFC 6749's shape; everything else in problem+json. */
const OAUTH_PATHS = /^\/(agent|oauth2)\//;

function base(relay: Relay, maxBody: number): App {
  const app = new Hono<Env>();
  app.onError((raw, c) => {
    const err = OAUTH_PATHS.test(c.req.path) ? asOAuthError(raw) : raw;
    if (err instanceof RelayError) {
      if (err.extra.retryAfterSeconds !== undefined) c.header('retry-after', String(Math.max(1, Math.ceil(err.extra.retryAfterSeconds))));
      if (err instanceof OAuthError) return c.json(err.toBody(), err.status as 400);
      return c.json(err.toProblem(), err.status as 400, { 'content-type': 'application/problem+json' });
    }
    relay.log.error('request.failed', { method: c.req.method, route: routePath(c, -1), error: err });
    return c.json(new RelayError(500, 'internal').toProblem(), 500, { 'content-type': 'application/problem+json' });
  });
  app.notFound((c) => c.json(new RelayError(404, 'not_found', 'No such route').toProblem(), 404, { 'content-type': 'application/problem+json' }));
  // Workers Cache stores a 200 that carries no Cache-Control for two hours, and a hit never reaches the Worker (so no
  // auth check). Everything is private unless the handler chose otherwise: only the docs do.
  app.use('*', async (c, next) => {
    await next();
    if (!c.res.headers.has('cache-control')) c.header('cache-control', 'private, no-store');
  });
  app.use('*', async (c, next) => {
    c.set('client', clientInfo(c));
    await next();
  });
  app.use(
    '*',
    bodyLimit({
      maxSize: maxBody,
      onError: () => {
        throw new RelayError(413, 'payload_too_large', `Bodies are limited to ${Math.round(maxBody / 1024)} KB`);
      },
    }),
  );
  return app;
}

const PUBLIC_ROUTES: RegisterRoutes[] = [
  site.register,
  auth.register,
  v1Me.register,
  v1Read.register,
  v1Conversations.register,
  v1Messages.register,
  v1Subscriptions.register,
  mcp.register,
  logan.register,
  discordInteractions.register,
];

const INTERNAL_ROUTES: RegisterRoutes[] = [
  ownerAgents.register,
  ownerChannels.register,
  ownerMessages.register,
  ownerSubscriptions.register,
  internalLogan.register,
  adminAgents.register,
  adminModeration.register,
  adminChannels.register,
  adminDeliveries.register,
  adminOps.register,
  showcase.register,
];

/**
 * What the internet reaches: /, /auth.md, /skill.md, auth.md's /.well-known, /agent and /oauth2 endpoints, /v1, /mcp, and the
 * Logan admin MCP's /mcp/admin with its OAuth endpoints under /oauth2/admin.
 */
export function relayApp(relay: Relay): App {
  const app = base(relay, 64 * 1024);
  for (const register of PUBLIC_ROUTES) register(app, relay);
  return app;
}

/** The dashboard's API. The backend serves it only from its InternalApi entrypoint, reachable through the service binding. */
export function internalApp(relay: Relay): App {
  const app = base(relay, 256 * 1024);
  app.use('/internal/*', internalAuth(relay));
  app.use('/internal/owners/:ownerId/*', ownerBinding());
  app.use('/internal/admin/*', adminGuard(relay));
  for (const register of INTERNAL_ROUTES) register(app, relay);
  return app;
}
