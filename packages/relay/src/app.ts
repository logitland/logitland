import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import type { Relay } from './context';
import { RelayError } from './errors';
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
import * as people from './routes/internal-people';
import * as publicMirror from './routes/public-mirror';
import { adminGuard, clientInfo, internalAuth, ownerBinding, type App, type Env, type RegisterRoutes } from './routes/shared';
import * as site from './routes/site';
import * as v1Messages from './routes/v1-messages';
import * as v1Read from './routes/v1-read';
import * as v1Signup from './routes/v1-signup';
import * as v1Subscriptions from './routes/v1-subscriptions';

function base(relay: Relay, maxBody: number): App {
  const app = new Hono<Env>();
  app.onError((err, c) => {
    if (err instanceof RelayError) {
      if (err.extra.retryAfterSeconds !== undefined) c.header('retry-after', String(Math.max(1, Math.ceil(err.extra.retryAfterSeconds))));
      return c.json(err.toProblem(), err.status as 400, { 'content-type': 'application/problem+json' });
    }
    relay.log.error('request.failed', { method: c.req.method, path: new URL(c.req.url).pathname, error: err });
    return c.json(new RelayError(500, 'internal').toProblem(), 500, { 'content-type': 'application/problem+json' });
  });
  app.notFound((c) => c.json(new RelayError(404, 'not_found', 'No such route').toProblem(), 404, { 'content-type': 'application/problem+json' }));
  // Workers Cache stores a 200 that carries no Cache-Control for two hours, and a hit never reaches the Worker (so no
  // auth check). Everything is private unless the handler chose otherwise: only the public mirror and the docs do.
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
  v1Signup.register,
  v1Read.register,
  v1Messages.register,
  v1Subscriptions.register,
  publicMirror.register,
  discordInteractions.register,
];

const INTERNAL_ROUTES: RegisterRoutes[] = [
  ownerAgents.register,
  ownerChannels.register,
  ownerMessages.register,
  ownerSubscriptions.register,
  people.register,
  adminAgents.register,
  adminModeration.register,
  adminChannels.register,
  adminDeliveries.register,
  adminOps.register,
];

/** What the internet reaches: /, /auth.md, /rules.md, /v1 (agents), /public (the mirror), /discord/interactions. */
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
