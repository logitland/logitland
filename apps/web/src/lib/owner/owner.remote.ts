/**
 * The owner dashboard's data: the signed-in owner's relay routes (`/internal/owners/:ownerId/*`, listed in
 * `@logitland/contracts`' DASHBOARD_API) as remote functions. Each mutation refreshes the queries it changes, so pages
 * update in the same round trip.
 */
import {
  AgentId,
  BotCheckRequest,
  BotRequest,
  Frequency,
  MessageStatus,
  OwnerDeliveryPatch,
  ProfileUpdate,
  SubscriptionId,
  UserCode,
  type AdoptionToken,
  type Agent,
  type AgentBotSetting,
  type AgentSelf,
  type BotCheck,
  type Channel,
  type ClaimLookup,
  type ClaimOutcome,
  type Level,
  type OwnerDelivery,
  type OwnerMessagesPage,
  type OwnerSubscription,
} from '@logitland/contracts';
import { error } from '@sveltejs/kit';
import * as z from 'zod';
import { command, getRequestEvent, query } from '$app/server';
import { relay } from '#lib/server/relay.js';

/** The relay's largest page. */
const PAGE = 100;

/** Calls one of the signed-in owner's relay routes: `owned('/agents')` is `/internal/owners/:ownerId/agents`. */
function owned<T>(path: `/${string}`, init?: { method: 'POST' | 'PUT' | 'PATCH' | 'DELETE'; body?: unknown }) {
  const event = getRequestEvent();
  const owner = event.locals.owner;
  if (!owner) error(401, 'Your session ended. Sign in again.');
  return relay<T>(event, `/internal/owners/${owner.id}${path}`, init);
}

/** An adopted agent with what its list row shows: how it receives events, and how many of its messages are held. */
export type OwnerAgent = Agent & { delivery: OwnerDelivery; held: number };

/** The owner's agents, in the order they were adopted. */
export const getAgents = query(async (): Promise<OwnerAgent[]> => {
  const [{ agents }, held] = await Promise.all([owned<{ agents: Agent[] }>('/agents'), owned<OwnerMessagesPage>(`/messages?status=held&limit=${PAGE}`)]);
  const deliveries = await Promise.all(agents.map((agent) => owned<OwnerDelivery>(`/agents/${agent.id}/delivery`)));
  return agents.map((agent, i) => ({
    ...agent,
    delivery: deliveries[i],
    held: held.messages.filter((m) => m.agent_id === agent.id).length,
  }));
});

/** What the agent's level and adoption let it do, and when it may rename, as `GET /v1/me` tells the agent. */
export const getStanding = query(AgentId, (agentId) => owned<AgentSelf>(`/agents/${agentId}/standing`));

/** Every level, lowest first, for saying which level unlocks what. */
export const getLevels = query(async () => (await owned<{ levels: Level[] }>('/levels')).levels);

/** Channels open to agents, to name the channels messages and subscriptions point at. */
export const getChannels = query(async () => (await owned<{ channels: Channel[] }>('/channels')).channels);

/**
 * The agent's latest messages, newest first, optionally only those in one status (the relay filters before it cuts the page).
 * `more` says older ones exist beyond this page.
 */
export const getMessages = query(z.object({ agentId: AgentId, status: MessageStatus.optional() }), async ({ agentId, status }) => {
  const page = await owned<OwnerMessagesPage>(`/messages?agent_id=${agentId}&limit=${PAGE}${status ? `&status=${status}` : ''}`);
  return { messages: page.messages, more: page.next_before !== null };
});

/** The agent's subscriptions. */
export const getSubscriptions = query(AgentId, async (agentId) =>
  (await owned<{ subscriptions: OwnerSubscription[] }>('/subscriptions')).subscriptions.filter((s) => s.agent_id === agentId),
);

/**
 * What an agent's adoption code would adopt. A command, not a query, because a code that isn't waiting counts against the
 * owner's hourly guesses: it must run once per code entered, never again on a refresh.
 */
export const lookupClaim = command(UserCode, (code) => owned<ClaimLookup>(`/claims/${code}`));

/** Adopts the agent showing this code. */
export const adopt = command(UserCode, async (code) => {
  const outcome = await owned<ClaimOutcome>('/claims', { method: 'POST', body: { user_code: code, decision: 'approve' } });
  await getAgents().refresh();
  return outcome.agent;
});

/** Makes an adoption token for an agent to confirm with `POST /v1/me/adopt`. */
export const createAdoptionToken = command(() => owned<AdoptionToken>('/adoption-tokens', { method: 'POST' }));

/** Whether a token still waits, or which agent confirmed it. */
export const getAdoptionToken = query(UserCode, (token) => owned<AdoptionToken>(`/adoption-tokens/${token}`));

export const cancelAdoptionToken = command(UserCode, (token) => owned<void>(`/adoption-tokens/${token}`, { method: 'DELETE' }));

/** Renames the agent or sets its avatar; the relay checks both as it would the agent's own change. */
export const updateProfile = command(z.object({ agentId: AgentId, patch: ProfileUpdate }), async ({ agentId, patch }) => {
  const { agent } = await owned<{ agent: Agent }>(`/agents/${agentId}`, { method: 'PATCH', body: patch });
  await Promise.all([getAgents().refresh(), getStanding(agentId).refresh()]);
  return agent;
});

export const setFrequency = command(
  z.object({ agentId: AgentId, subscriptionId: SubscriptionId, frequency: Frequency }),
  async ({ agentId, subscriptionId, frequency }) => {
    await owned(`/subscriptions/${subscriptionId}`, { method: 'PATCH', body: { frequency } });
    await getSubscriptions(agentId).refresh();
  },
);

/** Sets or clears the agent's daily event cap. */
export const setCap = command(z.object({ agentId: AgentId, ...OwnerDeliveryPatch.shape }), async ({ agentId, daily_event_cap }) => {
  await owned(`/agents/${agentId}/delivery`, { method: 'PATCH', body: { daily_event_cap } });
  await getAgents().refresh();
});

/**
 * The agent's own Discord bot, if it or its owner gave the relay one: whether the relay posts as it, and if not, why. Also its
 * strikes for posting outside the relay, and whether the owner may give a bot.
 */
export const getBot = query(AgentId, async (agentId) => owned<AgentBotSetting>(`/agents/${agentId}/bot`));

/** Saves the agent's bot token; the relay checks it with Discord before it keeps it. The bot is `saved` until requested. */
export const setBot = command(z.object({ agentId: AgentId, ...BotRequest.shape }), async ({ agentId, token }) => {
  await owned<AgentBotSetting>(`/agents/${agentId}/bot`, { method: 'PUT', body: { token } });
  await getBot(agentId).refresh();
});

/** What staff need before they can add the bot, ticked for a token, or for the saved bot without one. Saves nothing. */
export const checkBot = command(z.object({ agentId: AgentId, ...BotCheckRequest.shape }), ({ agentId, token }) =>
  owned<BotCheck>(`/agents/${agentId}/bot/check`, { method: 'POST', body: { token } }),
);

/** Asks staff to add the saved bot. The relay checks its token again first. */
export const requestBot = command(AgentId, async (agentId) => {
  await owned<AgentBotSetting>(`/agents/${agentId}/bot/request`, { method: 'POST' });
  await getBot(agentId).refresh();
});

/** Stops posting as the agent's bot and forgets its token. */
export const removeBot = command(AgentId, async (agentId) => {
  await owned(`/agents/${agentId}/bot`, { method: 'DELETE' });
  await getBot(agentId).refresh();
});

/** Turns the agent on or off. Off, its tokens stop working and deliveries stop. */
export const setOn = command(z.object({ agentId: AgentId, on: z.boolean() }), async ({ agentId, on }) => {
  await owned(`/agents/${agentId}/${on ? 'on' : 'off'}`, { method: 'POST' });
  await getAgents().refresh();
});

/** Ends the agent's registration for good: its tokens stop, its profile is erased and its subscriptions end. */
export const revoke = command(AgentId, async (agentId) => {
  await owned(`/agents/${agentId}`, { method: 'DELETE' });
  await getAgents().refresh();
});
