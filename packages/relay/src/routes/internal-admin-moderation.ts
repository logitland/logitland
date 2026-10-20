import { AppealDecision, AppealId, AppealStatus, MessageId, ModerationAction, ReleaseRequest, ReportAction, ReportStatus } from '@logitland/contracts';
import { parse } from '../errors';
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
import { intQuery, type AppContext, type RegisterRoutes } from './shared';

// The admin console's moderation API: the held queue, takedowns, reports, appeals and stats.
// Contracts and paths: packages/contracts/src/api.ts. The admin guard is already applied to /internal/admin/*.

/** Buttons send `{}` or nothing at all. */
const optionalBody = (c: AppContext): Promise<unknown> => c.req.json().catch(() => ({}));

export const register: RegisterRoutes = (app, relay) => {
  app.get('/internal/admin/moderation/queue', async (c) =>
    c.json(await moderationQueue(relay, { after: parse(MessageId.optional(), c.req.query('after') || undefined), limit: intQuery(c, 'limit', 50, 1, 100) })),
  );

  app.post('/internal/admin/messages/:messageId/release', async (c) => {
    const { note } = parse(ReleaseRequest, await optionalBody(c));
    return c.json(toRelayMessage(await release(relay, c.get('admin').id, c.req.param('messageId'), note)));
  });

  app.post('/internal/admin/messages/:messageId/reject', async (c) =>
    c.json(toRelayMessage(await reject(relay, c.get('admin').id, c.req.param('messageId'), parse(ModerationAction, await optionalBody(c))))),
  );

  app.post('/internal/admin/messages/:messageId/takedown', async (c) =>
    c.json(toRelayMessage(await takedown(relay, c.get('admin').id, c.req.param('messageId'), parse(ModerationAction, await optionalBody(c))))),
  );

  app.get('/internal/admin/reports', async (c) =>
    c.json(
      await listReports(relay, {
        status: parse(ReportStatus, c.req.query('status') || 'open'),
        limit: intQuery(c, 'limit', 50, 1, 100),
        offset: intQuery(c, 'offset', 0, 0, 100_000),
      }),
    ),
  );

  app.post('/internal/admin/reports/:reportId', async (c) =>
    c.json(await actOnReport(relay, c.get('admin').id, c.req.param('reportId'), parse(ReportAction, await optionalBody(c)))),
  );

  app.get('/internal/admin/appeals', async (c) =>
    c.json(
      await reviewAppeals(relay, {
        status: parse(AppealStatus, c.req.query('status') || 'open'),
        after: parse(AppealId.optional(), c.req.query('after') || undefined),
        limit: intQuery(c, 'limit', 50, 1, 100),
      }),
    ),
  );

  app.post('/internal/admin/appeals/:appealId', async (c) =>
    c.json(await decideAppeal(relay, c.get('admin').id, c.req.param('appealId'), parse(AppealDecision, await optionalBody(c)))),
  );

  app.get('/internal/admin/moderation/stats', async (c) => c.json(await moderationStats(relay)));
};
