import { AgentId, AgentStatus, AgentStatusAction, AgentTier, RevealIpRequest } from '@logitland/contracts';
import type { z } from 'zod';
import { invalid, parse } from '../errors';
import { audit } from '../services/audit';
import { adminAct, getAgent, listAgentsAdmin, toAgent } from '../services/identity';
import { revealRawIps } from '../services/origins';
import { SettingsPatch, getSettings, updateSettings } from '../services/settings';
import { body, intQuery, type AppContext, type RegisterRoutes } from './shared';

// Owned by B2 (identity and signup): the admin console's agent registry, IP reveal and settings. The internal app
// has already checked the dashboard token and that the signed-in owner is an admin.
// Contracts and paths: packages/contracts/src/api.ts.

function queryAs<S extends z.ZodType>(c: AppContext, name: string, schema: S, label: string): z.infer<S> | undefined {
  const raw = c.req.query(name);
  if (!raw) return undefined;
  const r = schema.safeParse(raw);
  if (!r.success) throw invalid(`${name} must be ${label}`);
  return r.data;
}

export const register: RegisterRoutes = (app, relay) => {
  app.get('/internal/admin/agents', async (c) =>
    c.json(
      await listAgentsAdmin(relay, {
        status: queryAs(c, 'status', AgentStatus, 'active, off, suspended or banned'),
        tier: queryAs(c, 'tier', AgentTier, 'new, claimed or trusted'),
        before: queryAs(c, 'before', AgentId, 'an agent ID'),
        q: c.req.query('q'),
        limit: intQuery(c, 'limit', 50, 1, 200),
      }),
    ),
  );

  app.post('/internal/admin/agents/:agentId/status', async (c) => {
    const agent = await adminAct(relay, c.get('admin').id, c.req.param('agentId'), parse(AgentStatusAction, await body(c)));
    return c.json({ agent: toAgent(agent) });
  });

  // The audit entry is written before anything is opened, so a reveal never goes unrecorded.
  app.post('/internal/admin/agents/:agentId/reveal-ip', async (c) => {
    const { reason } = parse(RevealIpRequest, await body(c));
    const agent = await getAgent(relay, c.req.param('agentId'));
    await audit(relay, { actor_type: 'admin', actor_id: c.get('admin').id, action: 'agent.ip_revealed', target_type: 'agent', target_id: agent.id, reason });
    c.header('cache-control', 'no-store');
    return c.json({ origins: await revealRawIps(relay, agent.id) });
  });

  app.get('/internal/admin/settings', async (c) => c.json(await getSettings(relay)));

  app.patch('/internal/admin/settings', async (c) => c.json(await updateSettings(relay, c.get('admin').id, parse(SettingsPatch, await body(c)))));
};
