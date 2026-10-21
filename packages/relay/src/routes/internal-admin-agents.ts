import {
  AgentId,
  AgentStatus,
  AgentStatusAction,
  CreateReaderRequest,
  Level,
  LevelUpdate,
  MessageId,
  MessageStatus,
  RevealIpRequest,
} from '@logitland/contracts';
import { z } from 'zod';
import { conflict, invalid, parse } from '../errors';
import { audit } from '../services/audit';
import { adminAct, getAgent, listAgentsAdmin, toAgent } from '../services/identity';
import { deleteLevel, listLevels, moveLevel, putLevel } from '../services/levels';
import { listAgentMessages } from '../services/messages';
import { revealRawIps } from '../services/origins';
import { SettingsPatch, getSettings, updateSettings } from '../services/settings';
import { createReader, updateProfile } from '../services/signup';
import { adminCan, body, intQuery, type AppContext, type RegisterRoutes } from './shared';

// The admin console's agent registry, agents' messages, levels, readers, IP reveal and settings. The internal app has already
// checked the dashboard token and that the signed-in owner is an admin. Any admin may read the registry, agents' messages and
// the levels; changes need the permission named on each route. Contracts and paths: packages/contracts/src/api.ts.

function queryAs<S extends z.ZodType>(c: AppContext, name: string, schema: S, label: string): z.infer<S> | undefined {
  const raw = c.req.query(name);
  if (!raw) return undefined;
  const r = schema.safeParse(raw);
  if (!r.success) throw invalid(`${name} must be ${label}`);
  return r.data;
}

const LevelParam = z.coerce.number().pipe(Level.shape.level);
/** POST /internal/admin/levels/:level/move */
const LevelMove = z.object({ to: Level.shape.level });

export const register: RegisterRoutes = (app, relay) => {
  const agents = adminCan('agents');
  const levels = adminCan('levels');
  const operate = adminCan('operate');

  app.get('/internal/admin/agents', async (c) =>
    c.json(
      await listAgentsAdmin(relay, {
        status: queryAs(c, 'status', AgentStatus, 'active, off, suspended or banned'),
        level: queryAs(c, 'level', LevelParam, 'a level number'),
        before: queryAs(c, 'before', AgentId, 'an agent ID'),
        q: c.req.query('q'),
        limit: intQuery(c, 'limit', 50, 1, 200),
      }),
    ),
  );

  app.post('/internal/admin/agents/:agentId/status', agents, async (c) => {
    const input = parse(AgentStatusAction, await body(c));
    const adminId = c.get('admin').id;
    const agentId = c.req.param('agentId');
    const { action } = input;
    if (action !== 'rename') return c.json({ agent: toAgent(relay, await adminAct(relay, adminId, agentId, { ...input, action })) });
    const agent = await getAgent(relay, agentId);
    if (agent.deleted_at) throw conflict('This agent’s registration was revoked, so it can’t be changed.');
    return c.json({ agent: toAgent(relay, await updateProfile(relay, agent, { name: input.name }, { type: 'admin', id: adminId, reason: input.reason })) });
  });

  app.get('/internal/admin/agents/:agentId/messages', async (c) =>
    c.json(
      await listAgentMessages(relay, (await getAgent(relay, c.req.param('agentId'))).id, {
        status: parse(MessageStatus.optional(), c.req.query('status') || undefined),
        before: parse(MessageId.optional(), c.req.query('before') || undefined),
        limit: intQuery(c, 'limit', 50, 1, 100),
      }),
    ),
  );

  // The audit entry is written before anything is opened, so a reveal never goes unrecorded.
  app.post('/internal/admin/agents/:agentId/reveal-ip', agents, async (c) => {
    const { reason } = parse(RevealIpRequest, await body(c));
    const agent = await getAgent(relay, c.req.param('agentId'));
    await audit(relay, { actor_type: 'admin', actor_id: c.get('admin').id, action: 'agent.ip_revealed', target_type: 'agent', target_id: agent.id, reason });
    c.header('cache-control', 'no-store');
    return c.json({ origins: await revealRawIps(relay, agent.id) });
  });

  app.get('/internal/admin/levels', async (c) => c.json({ levels: await listLevels(relay) }));

  app.put('/internal/admin/levels/:level', levels, async (c) =>
    c.json(await putLevel(relay, c.get('admin').id, parse(LevelParam, c.req.param('level')), parse(LevelUpdate, await body(c)))),
  );

  app.post('/internal/admin/levels/:level/move', levels, async (c) =>
    c.json(await moveLevel(relay, c.get('admin').id, parse(LevelParam, c.req.param('level')), parse(LevelMove, await body(c)).to)),
  );

  app.delete('/internal/admin/levels/:level', levels, async (c) => {
    await deleteLevel(relay, c.get('admin').id, parse(LevelParam, c.req.param('level')));
    return c.body(null, 204);
  });

  app.post('/internal/admin/readers', operate, async (c) => {
    c.header('cache-control', 'no-store');
    return c.json(await createReader(relay, c.get('admin').id, parse(CreateReaderRequest, await body(c))), 201);
  });

  app.get('/internal/admin/settings', operate, async (c) => c.json(await getSettings(relay)));

  app.patch('/internal/admin/settings', operate, async (c) => c.json(await updateSettings(relay, c.get('admin').id, parse(SettingsPatch, await body(c)))));
};
