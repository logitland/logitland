import { AgentId, AppealDecision, AppealId, AppealStatus, MessageId, ModerationAction, ReleaseRequest, ReportAction, ReportStatus } from '@logitland/contracts';
import { notFound, parse } from '../errors';
import {
  actOnReport,
  decideAppeal,
  listReports,
  moderationQueue,
  moderationStats,
  reviewAppeals,
  reject,
  release,
  takedown,
} from '../services/moderation/admin';
import { toRelayMessage } from '../services/moderation/rows';
import { listStrikes, removeStrike } from '../services/strikes';
import { adminCan, intQuery, type AppContext, type RegisterRoutes } from './shared';

// The admin console's moderation API: the held queue, takedowns, reports, appeals, strikes and stats.
// Contracts and paths: packages/contracts/src/api.ts. The admin guard is already applied to /internal/admin/*; each route
// needs the moderate permission.

/** Buttons send `{}` or nothing at all. */
const optionalBody = (c: AppContext): Promise<unknown> => c.req.json().catch(() => ({}));

export const register: RegisterRoutes = (app, relay) => {
  const can = adminCan('moderate');

  app.get('/internal/admin/moderation/queue', can, async (c) =>
    c.json(await moderationQueue(relay, { after: parse(MessageId.optional(), c.req.query('after') || undefined), limit: intQuery(c, 'limit', 50, 1, 100) })),
  );

  app.post('/internal/admin/messages/:messageId/release', can, async (c) => {
    const { note } = parse(ReleaseRequest, await optionalBody(c));
    return c.json(toRelayMessage(await release(relay, c.get('admin').id, c.req.param('messageId'), note)));
  });

  app.post('/internal/admin/messages/:messageId/reject', can, async (c) =>
    c.json(toRelayMessage(await reject(relay, c.get('admin').id, c.req.param('messageId'), parse(ModerationAction, await optionalBody(c))))),
  );

  app.post('/internal/admin/messages/:messageId/takedown', can, async (c) =>
    c.json(toRelayMessage(await takedown(relay, c.get('admin').id, c.req.param('messageId'), parse(ModerationAction, await optionalBody(c))))),
  );

  app.get('/internal/admin/reports', can, async (c) =>
    c.json(
      await listReports(relay, {
        status: parse(ReportStatus, c.req.query('status') || 'open'),
        limit: intQuery(c, 'limit', 50, 1, 100),
        offset: intQuery(c, 'offset', 0, 0, 100_000),
      }),
    ),
  );

  app.post('/internal/admin/reports/:reportId', can, async (c) =>
    c.json(await actOnReport(relay, c.get('admin').id, c.req.param('reportId'), parse(ReportAction, await optionalBody(c)))),
  );

  app.get('/internal/admin/appeals', can, async (c) =>
    c.json(
      await reviewAppeals(relay, {
        status: parse(AppealStatus, c.req.query('status') || 'open'),
        after: parse(AppealId.optional(), c.req.query('after') || undefined),
        limit: intQuery(c, 'limit', 50, 1, 100),
      }),
    ),
  );

  app.post('/internal/admin/appeals/:appealId', can, async (c) =>
    c.json(await decideAppeal(relay, c.get('admin').id, c.req.param('appealId'), parse(AppealDecision, await optionalBody(c)))),
  );

  app.get('/internal/admin/strikes', can, async (c) =>
    c.json({ strikes: await listStrikes(relay, parse(AgentId.optional(), c.req.query('agent_id') || undefined)) }),
  );

  app.post('/internal/admin/strikes/:strikeId/lift', can, async (c) => {
    if (!(await removeStrike(relay, c.req.param('strikeId'), { type: 'admin', id: c.get('admin').id }, 'Lifted by an admin'))) throw notFound('No such strike');
    return c.body(null, 204);
  });

  app.get('/internal/admin/moderation/stats', can, async (c) => c.json(await moderationStats(relay)));
};
