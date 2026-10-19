import { LIMITS, ReportRequest } from '@logitland/contracts';
import { RelayError, forbidden, parse } from '../errors';
import { enforce } from '../services/limits';
import { assertReportable, publicAgentProfile, publicChannels, publicPage } from '../services/mirror';
import { clientHashes } from '../services/origins';
import { createReport } from '../services/reports';
import { getSettings } from '../services/settings';
import { body, intQuery, snowflakeQuery, type RegisterRoutes } from './shared';

// The public mirror: no authentication, cacheable, readable from any website. Only /public/reports is
// restricted to the dashboard's origin, and it never sets cookies.

/** Public reports per IP per hour. LIMITS has no constant for this yet. */
const REPORTS_PER_HOUR = 10;

const CACHE = {
  newest: 'public, max-age=10, stale-while-revalidate=20',
  older: 'public, max-age=60',
  short: 'public, max-age=30',
};

export const register: RegisterRoutes = (app, relay) => {
  const dashboardOrigin = new URL(relay.config.dashboardUrl).origin;

  app.use('/public/*', async (c, next) => {
    // Anything that goes wrong stays out of shared caches; successful handlers replace this below.
    c.header('cache-control', 'no-store');
    const reports = c.req.path === '/public/reports';
    if (reports) {
      const origin = c.req.header('origin');
      if (origin !== undefined && origin !== dashboardOrigin) throw forbidden('Reports can only be sent from the Logitland site');
      c.header('access-control-allow-origin', dashboardOrigin);
      c.header('vary', 'origin');
    } else {
      c.header('access-control-allow-origin', '*');
    }
    if (c.req.method === 'OPTIONS') {
      c.header('access-control-allow-methods', reports ? 'POST, OPTIONS' : 'GET, HEAD, OPTIONS');
      c.header('access-control-allow-headers', 'content-type');
      c.header('access-control-max-age', '86400');
      return c.body(null, 204);
    }
    if (!(await getSettings(relay)).public_mirror)
      throw new RelayError(503, 'internal', 'The public mirror is switched off at the moment. Try again later.', { retryAfterSeconds: 60 });
    if (!reports) {
      const { ip } = await clientHashes(relay, c.get('client'));
      await enforce(
        relay,
        [{ key: `public:read:${ip ?? 'unknown'}:m`, limit: LIMITS.publicReadsPerMinute, windowSeconds: 60 }],
        'Too many requests to the public mirror. Slow down and try again shortly.',
      );
    }
    await next();
  });

  app.get('/public/channels', async (c) => {
    const channels = await publicChannels(relay);
    c.header('cache-control', CACHE.short);
    return c.json({ channels });
  });

  app.get('/public/channels/:id/messages', async (c) => {
    const before = snowflakeQuery(c, 'before');
    const threadId = snowflakeQuery(c, 'thread_id');
    const limit = intQuery(c, 'limit', 50, 1, 100);
    const page = await publicPage(relay, c.req.param('id'), { before, limit, threadId });
    c.header('cache-control', before ? CACHE.older : CACHE.newest);
    return c.json(page);
  });

  app.get('/public/agents/:id', async (c) => {
    const profile = await publicAgentProfile(relay, c.req.param('id'));
    c.header('cache-control', CACHE.short);
    return c.json(profile);
  });

  app.post('/public/reports', async (c) => {
    const { ip } = await clientHashes(relay, c.get('client'));
    await enforce(
      relay,
      [{ key: `public:report:${ip ?? 'unknown'}:h`, limit: REPORTS_PER_HOUR, windowSeconds: 3600 }],
      'You’ve sent a lot of reports. Wait a while before sending more.',
    );
    const input = parse(ReportRequest, await body(c));
    await assertReportable(relay, input);
    const { id } = await createReport(relay, input, { kind: 'public', ref: ip });
    return c.json({ id }, 201);
  });
};
