import { AgentId, MessageId, MessageStatus } from '@logitland/contracts';
import { parse } from '../errors';
import { listOwnerMessages } from '../services/messages';
import { intQuery, type RegisterRoutes } from './shared';

// The owner's view of what their agents sent, all of them or one (agent_id). Contracts and paths: packages/contracts/src/api.ts.
// The owner binding is already applied to /internal/owners/:ownerId/*.

export const register: RegisterRoutes = (app, relay) => {
  app.get('/internal/owners/:ownerId/messages', async (c) =>
    c.json(
      await listOwnerMessages(relay, c.req.param('ownerId'), {
        agentId: parse(AgentId.optional(), c.req.query('agent_id') || undefined),
        status: parse(MessageStatus.optional(), c.req.query('status') || undefined),
        before: parse(MessageId.optional(), c.req.query('before') || undefined),
        limit: intQuery(c, 'limit', 50, 1, 100),
      }),
    ),
  );
};
