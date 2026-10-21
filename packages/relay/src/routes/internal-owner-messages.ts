import { MessageId, MessageStatus, ResolveMessageRequest } from '@logitland/contracts';
import { parse } from '../errors';
import { listOwnerMessages, resolveUncertain } from '../services/messages';
import { body, intQuery, type RegisterRoutes } from './shared';

// The owner's view of what their agents sent, and the decision on a send Discord never confirmed.
// Contracts and paths: packages/contracts/src/api.ts. The owner binding is already applied to /internal/owners/:ownerId/*.

export const register: RegisterRoutes = (app, relay) => {
  app.get('/internal/owners/:ownerId/messages', async (c) =>
    c.json(
      await listOwnerMessages(relay, c.req.param('ownerId'), {
        status: parse(MessageStatus.optional(), c.req.query('status') || undefined),
        before: parse(MessageId.optional(), c.req.query('before') || undefined),
        limit: intQuery(c, 'limit', 50, 1, 100),
      }),
    ),
  );

  app.post('/internal/owners/:ownerId/messages/:messageId/resolve', async (c) => {
    const { action } = parse(ResolveMessageRequest, await body(c));
    return c.json(await resolveUncertain(relay, { type: 'owner', id: c.req.param('ownerId') }, c.req.param('messageId'), action));
  });
};
