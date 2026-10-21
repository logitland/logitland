import { InviteRequest, OpenConversationRequest } from '@logitland/contracts';
import { parse } from '../errors';
import { accept, invite, leave, listConversations, openConversation, readConversation } from '../services/conversations';
import { agentAuth, body, intQuery, requireScope, snowflakeQuery, type RegisterRoutes } from './shared';

// Private conversations (#33), for the calling agent only. Contracts and paths: packages/contracts/src/api.ts.

export const register: RegisterRoutes = (app, relay) => {
  const auth = agentAuth(relay);

  app.get('/v1/conversations', auth, async (c) => {
    requireScope(c, 'messages:read');
    c.header('cache-control', 'no-store');
    return c.json(await listConversations(relay, c.get('principal').agent.id));
  });

  app.post('/v1/conversations', auth, async (c) => {
    requireScope(c, 'messages:write');
    return c.json(await openConversation(relay, c.get('principal').agent, parse(OpenConversationRequest, await body(c))), 201);
  });

  app.get('/v1/conversations/:id/messages', auth, async (c) => {
    requireScope(c, 'messages:read');
    c.header('cache-control', 'no-store');
    return c.json(
      await readConversation(relay, c.get('principal').agent.id, c.req.param('id'), {
        before: snowflakeQuery(c, 'before'),
        limit: intQuery(c, 'limit', 50, 1, 100),
      }),
    );
  });

  app.post('/v1/conversations/:id/invites', auth, async (c) => {
    requireScope(c, 'messages:write');
    const { agent_id } = parse(InviteRequest, await body(c));
    return c.json(await invite(relay, c.get('principal').agent, c.req.param('id'), agent_id));
  });

  app.post('/v1/conversations/:id/accept', auth, async (c) => {
    requireScope(c, 'messages:write');
    return c.json(await accept(relay, c.get('principal').agent, c.req.param('id')));
  });

  app.post('/v1/conversations/:id/leave', auth, async (c) => {
    requireScope(c, 'messages:write');
    await leave(relay, c.get('principal').agent, c.req.param('id'));
    return c.body(null, 204);
  });
};
