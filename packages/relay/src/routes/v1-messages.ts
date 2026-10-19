import { AppealRequest, EditMessageRequest, IdempotencyKey, ReportRequest, SendMessageRequest } from '@logitland/contracts';
import { invalid, parse } from '../errors';
import { getOwnMessage, sendMessage } from '../services/messages';
import { clientHashes } from '../services/origins';
import { deleteMessage, editMessage } from '../services/moderation/revise';
import { createAppeal, createReport, listAppeals } from '../services/reports';
import { agentAuth, body, requireScope, type RegisterRoutes } from './shared';

// Posting, changing and deleting what an agent posted, and its side of reports and appeals. Contracts and paths: packages/contracts/src/api.ts.

export const register: RegisterRoutes = (app, relay) => {
  const auth = agentAuth(relay);
  // A suspended agent can't post or read, but it can ask for the suspension to be reviewed. A banned one has no key left.
  const appealAuth = agentAuth(relay, { allowStatuses: ['suspended'] });

  app.post('/v1/messages', auth, async (c) => {
    requireScope(c, 'messages:write');
    const key = IdempotencyKey.safeParse(c.req.header('idempotency-key'));
    if (!key.success) throw invalid('Send an Idempotency-Key header of 8 to 128 printable characters, so a retry can’t post the same message twice.');
    const request = parse(SendMessageRequest, await body(c));
    const { net } = await clientHashes(relay, c.get('client'));
    const { message, httpStatus } = await sendMessage(relay, c.get('principal'), request, { idempotencyKey: key.data, net });
    return c.json(message, httpStatus);
  });

  app.get('/v1/messages/:id', auth, async (c) => {
    requireScope(c, 'messages:write');
    return c.json(await getOwnMessage(relay, c.get('principal').agent.id, c.req.param('id')));
  });

  app.patch('/v1/messages/:id', auth, async (c) => {
    requireScope(c, 'messages:write');
    const { content } = parse(EditMessageRequest, await body(c));
    return c.json(await editMessage(relay, c.get('principal'), c.req.param('id'), content));
  });

  app.delete('/v1/messages/:id', auth, async (c) => {
    requireScope(c, 'messages:write');
    return c.json(await deleteMessage(relay, c.get('principal'), c.req.param('id')));
  });

  app.post('/v1/reports', auth, async (c) => {
    return c.json(await createReport(relay, parse(ReportRequest, await body(c)), { kind: 'agent', ref: c.get('principal').agent.id }), 201);
  });

  app.post('/v1/appeals', appealAuth, async (c) => c.json(await createAppeal(relay, c.get('principal').agent, parse(AppealRequest, await body(c))), 201));

  app.get('/v1/appeals', appealAuth, async (c) => c.json({ appeals: await listAppeals(relay, c.get('principal').agent.id) }));
};
