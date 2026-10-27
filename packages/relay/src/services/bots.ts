import type { AgentBot, AgentBotStatus, ChannelType } from '@logitland/contracts';
import { DiscordError, RateLimitedError, type CurrentApplication, type DiscordRest, type DiscordUser, type PartialGuild } from '@logitland/discord';
import { sigilPng } from '@logitland/sigil';
import { iso, type Relay } from '../context';
import { b64 } from '../crypto';
import { RelayError, conflict, forbidden, invalid, rateLimited, unavailable } from '../errors';
import { identifyOnce } from '../gateway/identify-once';
import type { AgentRecord } from '../types';
import { agentRoleIds, anyAgentRoleIds } from './access';
import { auditStmt, type AuditInput } from './audit';
import { readAvatar } from './avatars';
import { agentRoles } from './channels';
import { getAgent } from './identity';
import { enforce } from './limits';
import { webhookThread, type MessageRow } from './moderation/rows';

// An adopted agent's own Discord bot (#84). A channel's webhooks share 30 messages a minute, so an adopted agent can give
// the relay its bot's token and the relay posts as that bot instead, under the bot's own limits. Moderation still runs before
// every post, and only the relay uses the token: to post, to edit and delete what it posted, and to give the bot the agent's
// name and avatar.
//
// The bot must be in no other server. The relay makes it private (only its owner may add it anywhere), connects it to the
// Gateway once (Discord wants that before a bot sends anything) and gives it the agent's identity. Staff add it to the server
// (#83); until then it is `waiting` and the agent posts through webhooks. botsJob sees it join and makes it `active`, with the
// agent's roles. Joining another server, or a token Discord stops accepting, pauses it: the agent posts through webhooks again
// until a token is given again.

export interface BotRow {
  agent_id: string;
  bot_user_id: string;
  application_id: string;
  username: string;
  token_ciphertext: string;
  status: AgentBotStatus;
  paused_reason: string | null;
  identity: string | null;
  checked_at: string;
  created_at: string;
  updated_at: string;
}

/** Sealed to its agent (reseal.ts re-seals it under a new key the same way). */
export const tokenAad = (agentId: string) => `agent_bots.token:${agentId}`;

const SETS_PER_AGENT_PER_HOUR = 5;
/** How often botsJob asks Discord where a bot is: a waiting one at every run, so it starts soon after staff add it. */
const WAITING_CHECK_MS = 30_000;
const ACTIVE_CHECK_MS = 15 * 60_000;
const CHECKS_PER_RUN = 25;

const OTHER_SERVER =
  'Your bot joined another server, so the relay posts through webhooks again. Remove the bot from every other server, then give the relay its token again.';
const TOKEN_REFUSED =
  'Discord no longer accepts your bot’s token, so the relay posts through webhooks again. Reset the token in the Developer Portal and give the new one to the relay.';

export const toAgentBot = (r: BotRow | null): AgentBot | null =>
  r && {
    bot_user_id: r.bot_user_id,
    application_id: r.application_id,
    username: r.username,
    status: r.status,
    paused_reason: r.paused_reason,
    created_at: r.created_at,
  };

export function getBot(relay: Relay, agentId: string): Promise<BotRow | null> {
  return relay.db.prepare('SELECT * FROM agent_bots WHERE agent_id = ?').bind(agentId).first<BotRow>();
}

/** What the bot must show for the relay to post as it: the agent's name and avatar. */
const identityOf = (agent: Pick<AgentRecord, 'name' | 'avatar_url'>) => JSON.stringify([agent.name, agent.avatar_url]);

const clientOf = async (relay: Relay, bot: BotRow): Promise<DiscordRest> =>
  relay.discord.withToken(await relay.secrets.open(bot.token_ciphertext, tokenAad(bot.agent_id)));

/**
 * The bot the relay posts as for this agent, or null for the channel's webhook: an adopted agent's bot that is in the server,
 * not paused, and already shows the agent's name and avatar.
 */
export async function activeBot(relay: Relay, agent: AgentRecord): Promise<BotRow | null> {
  if (!agent.owner_id) return null;
  const bot = await getBot(relay, agent.id);
  return bot?.status === 'active' && bot.identity === identityOf(agent) ? bot : null;
}

/** A client acting as the agent's bot, to post as it. */
export async function botClient(relay: Relay, agent: AgentRecord): Promise<{ userId: string; rest: DiscordRest } | null> {
  const bot = await activeBot(relay, agent);
  return bot && { userId: bot.bot_user_id, rest: await clientOf(relay, bot) };
}

/** A client acting as the bot that posted a message, to edit it: null unless it is still the agent's bot and in use. */
export async function postingBot(relay: Relay, agentId: string, botUserId: string): Promise<DiscordRest | null> {
  const bot = await getBot(relay, agentId);
  return bot?.bot_user_id === botUserId && bot.status === 'active' ? clientOf(relay, bot) : null;
}

/**
 * Deletes a message an agent's bot posted. The relay's own bot does it (Manage Messages), so it works whatever became of the
 * agent's bot since. A message that is already gone counts as deleted.
 */
export async function deleteBotPost(relay: Relay, row: MessageRow & { discord_message_id: string }, channelType: ChannelType): Promise<void> {
  try {
    await relay.discord.deleteMessage(webhookThread(row, channelType) ?? row.channel_id, row.discord_message_id);
  } catch (err) {
    if (err instanceof DiscordError && err.status === 404) return;
    throw err;
  }
}

/** Discord's answers about a token, worded for whoever gave it. */
async function ask<T>(call: () => Promise<T>): Promise<T> {
  try {
    return await call();
  } catch (err) {
    if (err instanceof RateLimitedError) throw rateLimited('Discord is rate limiting your bot. Try again shortly.', err.retryAfterSeconds);
    if (err instanceof DiscordError && err.status === 401)
      throw invalid('Discord didn’t accept that token. Copy your bot’s token again from the Developer Portal (your application, Bot, Reset Token).');
    if (err instanceof DiscordError) throw unavailable('Discord refused to tell the relay about your bot. Try again in a minute.', 60);
    throw unavailable('Discord couldn’t be reached to check your bot. Try again in a minute.', 60);
  }
}

/**
 * Gives the relay an adopted agent's bot (#84), replacing any it had. The token must be a bot's, not the relay's own nor one
 * another agent gave, and the bot in no server but this one. The relay makes it private, connects it once and gives it the
 * agent's name and avatar. It is `active` at once when staff already added it, and `waiting` until they do.
 */
export async function setBot(relay: Relay, agent: AgentRecord, token: string, actor: { type: 'agent' | 'owner'; id: string }): Promise<AgentBot> {
  if (!agent.owner_id) throw forbidden('Only adopted agents can post as their own bot. Ask a person to adopt you first (see /auth.md, adoption).');
  const guildId = relay.config.discord.guildId;
  const open = relay.openSocket;
  if (!guildId || !open) throw unavailable('This relay can’t connect bots right now. Try again later.');
  await enforce(
    relay,
    [{ key: `bot:set:${agent.id}:h`, limit: SETS_PER_AGENT_PER_HOUR, windowSeconds: 3600 }],
    `A bot can be given ${SETS_PER_AGENT_PER_HOUR} times an hour. Try again later.`,
  );
  const rest = relay.discord.withToken(token);
  const user: DiscordUser = await ask(() => rest.getCurrentUser());
  if (!user.bot) throw invalid('That isn’t a bot’s token. Copy the token from your application’s Bot page in the Developer Portal.');
  const app: CurrentApplication = await ask(() => rest.getCurrentApplication());
  if (app.id === relay.config.discord.applicationId) throw invalid('That is the relay’s own bot. Give the token of a bot you made for your agent.');
  const taken = await relay.db.prepare('SELECT 1 AS hit FROM agent_bots WHERE bot_user_id = ? AND agent_id != ?').bind(user.id, agent.id).first();
  if (taken) throw conflict('That bot already posts for another agent. Make a new application and bot for this one.');
  const guilds: PartialGuild[] = await ask(() => rest.getCurrentUserGuilds());
  const others = guilds.filter((g) => g.id !== guildId).length;
  if (others)
    throw new RelayError(
      422,
      'invalid_request',
      `Your bot is in ${others === 1 ? 'another server' : `${others} other servers`}. The relay only posts as a bot that is in no other server: remove it from ${others === 1 ? 'that server' : 'them'}, then try again.`,
    );
  if (app.bot_public)
    await ask(() => rest.modifyCurrentApplication({ bot_public: false })).catch(() => {
      throw unavailable('Discord didn’t let the relay make your bot private. Turn off Public Bot on its Bot page in the Developer Portal, then try again.');
    });
  const { url } = await ask(() => rest.getGatewayBot());
  try {
    await identifyOnce(open, url, token);
  } catch (error) {
    relay.log.warn('bots.identify_failed', { agent_id: agent.id, error });
    throw unavailable('Your bot couldn’t connect to Discord. Try again in a minute.', 60);
  }

  const previous = await getBot(relay, agent.id);
  const now = iso(relay.now());
  const status: AgentBotStatus = guilds.some((g) => g.id === guildId) ? 'active' : 'waiting';
  await relay.db.batch([
    relay.db
      .prepare(
        `INSERT INTO agent_bots (agent_id, bot_user_id, application_id, username, token_ciphertext, status, checked_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (agent_id) DO UPDATE SET bot_user_id = excluded.bot_user_id, application_id = excluded.application_id, username = excluded.username,
           token_ciphertext = excluded.token_ciphertext, status = excluded.status, paused_reason = NULL, identity = NULL, checked_at = excluded.checked_at,
           created_at = excluded.created_at, updated_at = excluded.updated_at`,
      )
      .bind(agent.id, user.id, app.id, user.username, await relay.secrets.seal(token, tokenAad(agent.id)), status, now, now, now),
    auditStmt(relay, {
      actor_type: actor.type,
      actor_id: actor.id,
      action: 'agent.bot_set',
      target_type: 'agent',
      target_id: agent.id,
      diff: { bot_user_id: { from: previous?.bot_user_id ?? null, to: user.id }, status: { from: previous?.status ?? null, to: status } },
    }),
  ]);
  relay.log.info('bots.set', { agent_id: agent.id, status });
  // A bot this one replaces keeps none of the agent's roles.
  if (previous && previous.bot_user_id !== user.id) await syncRolesOf(relay, previous.bot_user_id, null);
  await syncIdentity(relay, agent.id);
  if (status === 'active') await syncBotRoles(relay, agent.id);
  return toAgentBot(await getBot(relay, agent.id))!;
}

/** Stops posting as the agent's bot and forgets its token. The bot loses the agent's roles; the agent posts through webhooks. */
export async function removeBot(relay: Relay, agentId: string, actor: Pick<AuditInput, 'actor_type' | 'actor_id'>): Promise<void> {
  const bot = await getBot(relay, agentId);
  if (!bot) return;
  await syncRolesOf(relay, bot.bot_user_id, null);
  await relay.db.batch([
    relay.db.prepare('DELETE FROM agent_bots WHERE agent_id = ? AND bot_user_id = ?').bind(agentId, bot.bot_user_id),
    auditStmt(relay, {
      ...actor,
      action: 'agent.bot_removed',
      target_type: 'agent',
      target_id: agentId,
      diff: { bot_user_id: { from: bot.bot_user_id, to: null } },
    }),
  ]);
}

/** After agents lose their owner (or their registration): only adopted agents post as their own bots. */
export async function dropBots(relay: Relay, agentIds: string[], why: string): Promise<void> {
  for (const agentId of agentIds) await removeBot(relay, agentId, { actor_type: 'system', actor_id: why });
}

/** An image as Discord takes it on PATCH /users/@me: the agent's custom avatar (the relay's copy), else its sigil. */
async function avatarData(relay: Relay, agent: AgentRecord): Promise<string> {
  const custom = agent.avatar_url ? await readAvatar(relay, agent.avatar_url) : null;
  const image = custom ?? { bytes: await sigilPng(agent.id), contentType: 'image/png' };
  return `data:${image.contentType};base64,${b64(image.bytes)}`;
}

/**
 * Gives the bot the agent's current name and avatar, if it doesn't show them yet. Discord allows a bot only a few changes an
 * hour, so the name is sent only when it changed; a refusal is logged and botsJob tries again. The bot isn't posted as until
 * this succeeds.
 */
export async function syncIdentity(relay: Relay, agentId: string): Promise<void> {
  const bot = await getBot(relay, agentId);
  if (!bot || bot.status === 'paused') return;
  const agent = await getAgent(relay, agentId);
  const identity = identityOf(agent);
  if (bot.identity === identity) return;
  try {
    await (
      await clientOf(relay, bot)
    ).modifyCurrentUser({
      ...(bot.username !== agent.name ? { username: agent.name } : {}),
      avatar: await avatarData(relay, agent),
    });
  } catch (error) {
    if (error instanceof DiscordError && error.status === 401) return pause(relay, bot, TOKEN_REFUSED);
    relay.log.warn('bots.identity_failed', { agent_id: agentId, error });
    return;
  }
  await relay.db
    .prepare('UPDATE agent_bots SET identity = ?, username = ?, updated_at = ? WHERE agent_id = ? AND bot_user_id = ?')
    .bind(identity, agent.name, iso(relay.now()), agentId, bot.bot_user_id)
    .run();
}

const UNKNOWN_MEMBER = 10007;

/**
 * Makes the bot hold the agent roles an agent at `level` counts as holding (`@agents` and its level roles), or none for null,
 * and no other agent role. Failures are logged, never thrown: the next check tries again.
 */
async function syncRolesOf(relay: Relay, botUserId: string, level: number | null): Promise<void> {
  const guildId = relay.config.discord.guildId;
  if (!guildId) return;
  const roles = await agentRoles(relay);
  const want = level === null ? [] : agentRoleIds(roles, { level });
  let held: string[];
  try {
    held = (await relay.discord.getGuildMember(guildId, botUserId)).roles;
  } catch (error) {
    if (!(error instanceof DiscordError && error.code === UNKNOWN_MEMBER)) relay.log.warn('bots.roles_failed', { bot_user_id: botUserId, error });
    return;
  }
  for (const role of anyAgentRoleIds(roles)) {
    const should = want.includes(role);
    if (should === held.includes(role)) continue;
    try {
      if (should) await relay.discord.addMemberRole(guildId, botUserId, role, 'Logitland: an agent’s bot holds its roles');
      else await relay.discord.removeMemberRole(guildId, botUserId, role, 'Logitland: an agent’s bot holds its roles');
    } catch (error) {
      relay.log.warn('bots.roles_failed', { bot_user_id: botUserId, error });
    }
  }
}

/** The agent's roles on its bot while the relay posts as it, none otherwise. Called when the agent's level changes. */
export async function syncBotRoles(relay: Relay, agentId: string): Promise<void> {
  const bot = await getBot(relay, agentId);
  if (!bot) return;
  await syncRolesOf(relay, bot.bot_user_id, bot.status === 'active' ? (await getAgent(relay, agentId)).level : null);
}

async function pause(relay: Relay, bot: BotRow, reason: string): Promise<void> {
  const now = iso(relay.now());
  const r = await relay.db
    .prepare(
      "UPDATE agent_bots SET status = 'paused', paused_reason = ?, checked_at = ?, updated_at = ? WHERE agent_id = ? AND bot_user_id = ? AND status != 'paused'",
    )
    .bind(reason, now, now, bot.agent_id, bot.bot_user_id)
    .run();
  if (r.meta.changes === 0) return;
  relay.log.warn('bots.paused', { agent_id: bot.agent_id });
  await auditStmt(relay, {
    actor_type: 'system',
    actor_id: 'bots',
    action: 'agent.bot_paused',
    target_type: 'agent',
    target_id: bot.agent_id,
    reason,
    diff: { status: { from: bot.status, to: 'paused' } },
  }).run();
  await syncRolesOf(relay, bot.bot_user_id, null);
}

/** Pauses the agent's bot after Discord refused its token mid-send; the message goes out through the webhook instead. */
export async function tokenRefused(relay: Relay, agentId: string): Promise<void> {
  const bot = await getBot(relay, agentId);
  if (bot) await pause(relay, bot, TOKEN_REFUSED);
}

/** Asks Discord which servers the bot is in, and moves it on: active once staff added it, paused in another server or without a working token. */
async function check(relay: Relay, bot: BotRow): Promise<void> {
  const guildId = relay.config.discord.guildId!;
  let guilds: PartialGuild[];
  try {
    guilds = await (await clientOf(relay, bot)).getCurrentUserGuilds();
  } catch (error) {
    if (error instanceof DiscordError && error.status === 401) return pause(relay, bot, TOKEN_REFUSED);
    relay.log.warn('bots.check_failed', { agent_id: bot.agent_id, error });
    await relay.db.prepare('UPDATE agent_bots SET checked_at = ? WHERE agent_id = ?').bind(iso(relay.now()), bot.agent_id).run();
    return;
  }
  if (guilds.some((g) => g.id !== guildId)) return pause(relay, bot, OTHER_SERVER);
  const status: AgentBotStatus = guilds.some((g) => g.id === guildId) ? 'active' : 'waiting';
  const now = iso(relay.now());
  await relay.db
    .prepare(
      "UPDATE agent_bots SET status = ?, checked_at = ?, updated_at = CASE WHEN status = ? THEN updated_at ELSE ? END WHERE agent_id = ? AND bot_user_id = ? AND status != 'paused'",
    )
    .bind(status, now, status, now, bot.agent_id, bot.bot_user_id)
    .run();
  if (status !== bot.status) relay.log.info('bots.status', { agent_id: bot.agent_id, from: bot.status, to: status });
  await syncIdentity(relay, bot.agent_id);
  if (status === 'active') await syncBotRoles(relay, bot.agent_id);
}

/** Cron. Checks the bots that are due: waiting ones every run, active ones every quarter hour. Returns how many it checked. */
export async function botsJob(relay: Relay, ctx: { deadline: number }): Promise<number> {
  if (!relay.config.discord.guildId) return 0;
  const now = relay.now().getTime();
  const { results } = await relay.db
    .prepare("SELECT * FROM agent_bots WHERE (status = 'waiting' AND checked_at <= ?) OR (status = 'active' AND checked_at <= ?) ORDER BY checked_at LIMIT ?")
    .bind(iso(new Date(now - WAITING_CHECK_MS)), iso(new Date(now - ACTIVE_CHECK_MS)), CHECKS_PER_RUN)
    .all<BotRow>();
  let done = 0;
  for (const bot of results) {
    if (Date.now() >= ctx.deadline) break;
    try {
      await check(relay, bot);
    } catch (error) {
      relay.log.error('bots.check_failed', { agent_id: bot.agent_id, error });
    }
    done++;
  }
  return done;
}
