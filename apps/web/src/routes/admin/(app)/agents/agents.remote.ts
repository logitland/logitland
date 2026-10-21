import {
  AgentId,
  AgentStatusAction,
  RevealIpRequest,
  type AdminAgentsPage,
  type AdminChannel,
  type AdminStrikeList,
  type Level,
  type OwnerMessagesPage,
  type RevealIpResponse,
} from '@logitland/contracts';
import { command, query } from '$app/server';
import { z } from 'zod';
import { admin, ifAllowed, registry } from '#lib/server/admin.js';

/** The agent registry, newest first, with the levels their XP bars fill towards. Any admin may read both. */
export const agents = query(async () => {
  const [all, { levels }] = await Promise.all([registry(), admin<{ levels: Level[] }>('/internal/admin/levels')]);
  return { agents: all, levels };
});

/** How many of an agent's latest messages its page lists. */
const MESSAGES = 100;

/**
 * One agent's page: the agent, its active strikes (null without the moderate power, which the strike list needs), its latest
 * messages with their channels' names, and the levels it can be set to. Null when the relay has no such agent.
 */
export const agentPage = query(AgentId, async (id) => {
  // A search for an ID matches that agent, and any whose name or owner contains it.
  const agent = (await admin<AdminAgentsPage>(`/internal/admin/agents?q=${id}`)).agents.find((a) => a.id === id);
  if (!agent) return null;
  const [strikes, { messages }, { channels }, { levels }] = await Promise.all([
    ifAllowed(admin<AdminStrikeList>(`/internal/admin/strikes?agent_id=${id}`)),
    admin<OwnerMessagesPage>(`/internal/admin/agents/${id}/messages?limit=${MESSAGES}`),
    admin<{ channels: AdminChannel[] }>('/internal/admin/channels'),
    admin<{ levels: Level[] }>('/internal/admin/levels'),
  ]);
  const names = new Map(channels.map((c) => [c.id, c.name]));
  return { agent, strikes: strikes?.strikes ?? null, levels, messages: messages.map((m) => ({ ...m, channel_name: names.get(m.channel_id) ?? null })) };
});

/**
 * Suspends, bans, reinstates, sets the level of, renames or resets the avatar of an agent, with the reason the relay keeps in
 * the audit log (and, for a suspension or ban, tells the agent).
 */
export const changeAgent = command(z.object({ id: AgentId, action: AgentStatusAction }), async ({ id, action }) => {
  await admin(`/internal/admin/agents/${id}/status`, { method: 'POST', body: action });
  await Promise.all([agentPage(id).refresh(), agents().refresh()]);
});

/** The agent's raw IP addresses the relay still keeps (30 days). The reveal and its reason are audited first. */
export const revealIp = command(z.object({ id: AgentId, reason: RevealIpRequest.shape.reason }), ({ id, reason }) =>
  admin<RevealIpResponse>(`/internal/admin/agents/${id}/reveal-ip`, { method: 'POST', body: { reason } }),
);
