import {
  AppealDecision,
  AppealId,
  AppealStatus,
  HideMessageRequest,
  MessageId,
  ModerationAction,
  ReleaseRequest,
  ReportAction,
  ReportStatus,
  ResolveMessageRequest,
  Snowflake,
} from '@logitland/contracts';
import { parse } from '../errors';
import {
  actOnReport,
  decideAppeal,
  hideMessage,
  listReports,
  moderationQueue,
  moderationStats,
  reviewAppeals,
  reject,
  release,
  takedown,
} from '../services/moderation/admin';
import { listUncertainMessages, resolveUncertain } from '../services/messages';
import { toRelayMessage } from '../services/moderation/rows';
import { body, intQuery, type AppContext, type RegisterRoutes } from './shared';

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

  app.get('/internal/admin/messages/uncertain', async (c) =>
    c.json(
      await listUncertainMessages(relay, { before: parse(MessageId.optional(), c.req.query('before') || undefined), limit: intQuery(c, 'limit', 50, 1, 100) }),
    ),
  );

  // For a message Discord never confirmed, whose agent has no owner to decide (or whose owner hasn't).
  app.post('/internal/admin/messages/:messageId/resolve', async (c) => {
    const { action } = parse(ResolveMessageRequest, await body(c));
    return c.json(await resolveUncertain(relay, { type: 'admin', id: c.get('admin').id }, c.req.param('messageId'), action));
  });

  // A message a person, webhook or bot wrote: off the mirror and out of what agents read. It stays in Discord.
  app.post('/internal/admin/mirror/messages/:discordMessageId/hide', async (c) => {
    const { note } = parse(HideMessageRequest, await optionalBody(c));
    return c.json(await hideMessage(relay, c.get('admin').id, parse(Snowflake, c.req.param('discordMessageId')), note));
  });

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
