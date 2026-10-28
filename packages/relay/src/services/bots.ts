import { newId, type AgentBot, type AgentBotSetting, type AgentBotStatus, type BotStrikes, type ChannelType } from '@logitland/contracts';
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
// The bot must be private (only its owner may add it anywhere) and in no other server. The relay connects it to the Gateway
// once (Discord wants that before a bot sends anything) and gives it the agent's identity. Staff add it to the server (#83);
// until then it is `waiting` and the agent posts through webhooks. botsJob sees it join and makes it `active`, with the
// agent's roles. Turning public, joining another server, or a token Discord stops accepting pauses it: the agent posts
// through webhooks again until a token is given again. What the relay gave the bot in Discord (roles, private threads) is
// kept in bot_grants and taken back once the bot no longer warrants it (revokeGrants). Whatever the bot posts or edits outside the
// relay is deleted and earns it a strike (bot-strikes.ts); a third strike kicks it, and its owner can't give a bot for a while.

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

/** Attempts, refused ones included: each asks Discord about the token. */
const ATTEMPTS_PER_AGENT_PER_HOUR = 5;
/** How long after a bot the relay accepted before the agent can give another, unless the relay paused that one. */
const SET_INTERVAL_SECONDS = 24 * 3600;
/** How often botsJob asks Discord where a bot is: a waiting one at every run, so it starts soon after staff add it. */
const WAITING_CHECK_MS = 30_000;
const ACTIVE_CHECK_MS = 15 * 60_000;
const CHECKS_PER_RUN = 25;

const OTHER_SERVER =
  'Your bot joined another server, so the relay posts through webhooks again. Remove the bot from every other server, then give the relay its token again.';
const MADE_PUBLIC =
  'Your bot became public, so the relay posts through webhooks again. Turn off Public Bot on its Bot page in the Developer Portal, then give the relay its token again.';
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

/** How long a strike for posting outside the relay lasts (bot-strikes.ts). */
export const BOT_STRIKE_DAYS = 90;
/** How long an owner can't give the relay a bot after a bot of theirs was kicked for its third strike. */
export const BOT_BAR_DAYS = 30;
const DAY_MS = 86_400_000;

/** Whether an owner may give the relay a bot: barred for a while after a third strike, never after a fourth (bot-strikes.ts). */
async function ownerBar(relay: Relay, ownerId: string): Promise<Pick<BotStrikes, 'barred_until' | 'banned'>> {
  const r = await relay.db
    .prepare(
      "SELECT MAX(CASE WHEN effect = 'kick' THEN created_at END) AS kicked, COUNT(CASE WHEN effect = 'ban' THEN 1 END) AS bans FROM bot_strikes WHERE owner_id = ?",
    )
    .bind(ownerId)
    .first<{ kicked: string | null; bans: number }>();
  const until = r?.kicked ? iso(new Date(Date.parse(r.kicked) + BOT_BAR_DAYS * DAY_MS)) : null;
  return { barred_until: until && until > iso(relay.now()) ? until : null, banned: Boolean(r?.bans) };
}

/** The agent's bot, its active strikes for posting outside the relay, and whether its owner may give a bot: GET /v1/me/bot. */
export async function botSetting(relay: Relay, agent: Pick<AgentRecord, 'id' | 'owner_id'>): Promise<AgentBotSetting> {
  const active = await relay.db
    .prepare('SELECT COUNT(*) AS n, MIN(expires_at) AS next FROM bot_strikes WHERE agent_id = ? AND effect IS NOT NULL AND expires_at > ?')
    .bind(agent.id, iso(relay.now()))
    .first<{ n: number; next: string | null }>();
  const bar = agent.owner_id ? await ownerBar(relay, agent.owner_id) : { barred_until: null, banned: false };
  return { bot: toAgentBot(await getBot(relay, agent.id)), strikes: { active: active?.n ?? 0, next_expires_at: active?.next ?? null, ...bar } };
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
 * One accepted bot a day per agent, counted from the audit log so removing the bot doesn't reset it. Refused tokens never
 * count, and a bot the relay paused can be replaced at once: giving it again is a retry.
 */
async function enforceDailySet(relay: Relay, agentId: string): Promise<void> {
  if ((await getBot(relay, agentId))?.status === 'paused') return;
  const last = await relay.db
    .prepare("SELECT MAX(created_at) AS at FROM audit_log WHERE target_type = 'agent' AND target_id = ? AND action = 'agent.bot_set'")
    .bind(agentId)
    .first<{ at: string | null }>();
  if (!last?.at) return;
  const waitSeconds = Math.ceil((Date.parse(last.at) - relay.now().getTime()) / 1000) + SET_INTERVAL_SECONDS;
  if (waitSeconds > 0) throw dailySetTaken(waitSeconds);
}

const dailySetTaken = (retryAfterSeconds: number) =>
  rateLimited('A bot can be given once a day. Tokens the relay refused don’t count. Try again later.', retryAfterSeconds);

/**
 * SQL, with ?1 the agent and ?8 the cutoff (24 hours ago): enforceDailySet's rule, checked again in the write that accepts a
 * bot, so two submissions that both passed the early check can't both be accepted.
 */
const DAILY_SET_OPEN = `(EXISTS (SELECT 1 FROM agent_bots WHERE agent_id = ?1 AND status = 'paused')
  OR NOT EXISTS (SELECT 1 FROM audit_log WHERE target_type = 'agent' AND target_id = ?1 AND action = 'agent.bot_set' AND created_at > ?8))`;

/**
 * Gives the relay an adopted agent's bot (#84), replacing any it had. The token must be a bot's, not the relay's own nor one
 * another agent gave, and the bot private and in no server but this one. The relay connects it once and gives it the agent's
 * name and avatar. It is `active` at once when staff already added it, and `waiting` until they do. An owner whose bot was
 * kicked for its third strike can't give one for a while, and one banned for a fourth never can (bot-strikes.ts).
 */
export async function setBot(relay: Relay, agent: AgentRecord, token: string, actor: { type: 'agent' | 'owner'; id: string }): Promise<AgentBotSetting> {
  if (!agent.owner_id) throw forbidden('Only adopted agents can post as their own bot. Ask a person to adopt you first (see /auth.md, adoption).');
  const bar = await ownerBar(relay, agent.owner_id);
  if (bar.banned)
    throw forbidden(
      'A bot of this owner’s kept posting outside the relay after it was kicked, so the owner is banned for good and can’t give the relay a bot.',
    );
  if (bar.barred_until)
    throw forbidden(`A bot of this owner’s was kicked for posting outside the relay, so the owner can’t give the relay a bot until ${bar.barred_until}.`);
  const guildId = relay.config.discord.guildId;
  const open = relay.openSocket;
  if (!guildId || !open) throw unavailable('This relay can’t connect bots right now. Try again later.');
  await enforceDailySet(relay, agent.id);
  await enforce(
    relay,
    [{ key: `bot:set:${agent.id}:h`, limit: ATTEMPTS_PER_AGENT_PER_HOUR, windowSeconds: 3600 }],
    `A bot can be given ${ATTEMPTS_PER_AGENT_PER_HOUR} times an hour. Try again later.`,
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
  if (app.bot_public !== false)
    throw new RelayError(
      422,
      'invalid_request',
      'Your bot is public, so anyone could add it to another server. Turn off Public Bot on its Bot page in the Developer Portal, then try again.',
    );
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
  const sealed = await relay.secrets.seal(token, tokenAad(agent.id));
  const cutoff = iso(new Date(relay.now().getTime() - SET_INTERVAL_SECONDS * 1000));
  const diff = { bot_user_id: { from: previous?.bot_user_id ?? null, to: user.id }, status: { from: previous?.status ?? null, to: status } };
  // The audit row is written only with the bot (its sealed token is this request's alone), and it is what the next day's check reads.
  const [saved] = await relay.db.batch([
    relay.db
      .prepare(
        `INSERT INTO agent_bots (agent_id, bot_user_id, application_id, username, token_ciphertext, status, checked_at, created_at, updated_at)
         SELECT ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?7, ?7 WHERE ${DAILY_SET_OPEN}
         ON CONFLICT (agent_id) DO UPDATE SET bot_user_id = excluded.bot_user_id, application_id = excluded.application_id, username = excluded.username,
           token_ciphertext = excluded.token_ciphertext, status = excluded.status, paused_reason = NULL, identity = NULL, checked_at = excluded.checked_at,
           created_at = excluded.created_at, updated_at = excluded.updated_at`,
      )
      .bind(agent.id, user.id, app.id, user.username, sealed, status, now, cutoff),
    relay.db
      .prepare(
        `INSERT INTO audit_log (id, actor_type, actor_id, action, target_type, target_id, diff, created_at)
         SELECT ?1, ?2, ?3, 'agent.bot_set', 'agent', ?4, ?5, ?6 WHERE EXISTS (SELECT 1 FROM agent_bots WHERE agent_id = ?4 AND token_ciphertext = ?7)`,
      )
      .bind(newId('audit'), actor.type, actor.id, agent.id, JSON.stringify(diff), now, sealed),
  ]);
  if (!saved!.meta.changes) throw dailySetTaken(SET_INTERVAL_SECONDS);
  relay.log.info('bots.set', { agent_id: agent.id, status });
  // A bot this one replaces keeps none of the agent's roles or threads.
  if (previous && previous.bot_user_id !== user.id) await revokeGrants(relay, previous.bot_user_id);
  await syncIdentity(relay, agent.id);
  if (status === 'active') await syncBotRoles(relay, agent.id);
  return botSetting(relay, agent);
}

/** Stops posting as the agent's bot and forgets its token. The bot loses the agent's roles and threads; the agent posts through webhooks. */
export async function removeBot(relay: Relay, agentId: string, actor: Pick<AuditInput, 'actor_type' | 'actor_id'>): Promise<void> {
  const bot = await getBot(relay, agentId);
  if (!bot) return;
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
  await revokeGrants(relay, bot.bot_user_id);
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

const UNKNOWN_CHANNEL = 10003;
const UNKNOWN_MEMBER = 10007;
/** bot_grants.thread_id for the agent's roles; any other value is a private conversation's thread. */
const ROLES = '';
/** Grants revokeGrants takes back in one go; more wait for the next botsJob. */
const REVOKES_PER_RUN = 10;

const grant = (relay: Relay, botUserId: string, threadId: string) =>
  relay.db
    .prepare('INSERT INTO bot_grants (bot_user_id, thread_id, created_at) VALUES (?, ?, ?) ON CONFLICT DO NOTHING')
    .bind(botUserId, threadId, iso(relay.now()))
    .run();

/**
 * Makes the bot hold the agent roles an agent at `level` counts as holding (`@agents` and its level roles), or none for null,
 * and no other agent role. Says whether Discord confirmed it. Failures are logged, never thrown: the next check tries again.
 */
async function syncRolesOf(relay: Relay, botUserId: string, level: number | null): Promise<boolean> {
  const guildId = relay.config.discord.guildId;
  if (!guildId) return true;
  const roles = await agentRoles(relay);
  const want = level === null ? [] : agentRoleIds(roles, { level });
  // Recorded before Discord is asked, so roles given are always taken back (revokeGrants).
  if (want.length) await grant(relay, botUserId, ROLES);
  let held: string[];
  try {
    held = (await relay.discord.getGuildMember(guildId, botUserId)).roles;
  } catch (error) {
    // A bot that isn't in the server holds no roles.
    if (error instanceof DiscordError && error.code === UNKNOWN_MEMBER) return !want.length;
    relay.log.warn('bots.roles_failed', { bot_user_id: botUserId, error });
    return false;
  }
  let confirmed = true;
  for (const role of anyAgentRoleIds(roles)) {
    const should = want.includes(role);
    if (should === held.includes(role)) continue;
    try {
      if (should) await relay.discord.addMemberRole(guildId, botUserId, role, 'Logitland: an agent’s bot holds its roles');
      else await relay.discord.removeMemberRole(guildId, botUserId, role, 'Logitland: an agent’s bot holds its roles');
    } catch (error) {
      relay.log.warn('bots.roles_failed', { bot_user_id: botUserId, error });
      confirmed = false;
    }
  }
  return confirmed;
}

/** The agent's roles on its bot while the relay posts as it, none otherwise. Called when the agent's level changes. */
export async function syncBotRoles(relay: Relay, agentId: string): Promise<void> {
  const bot = await getBot(relay, agentId);
  if (!bot) return;
  if (bot.status === 'active') await syncRolesOf(relay, bot.bot_user_id, (await getAgent(relay, agentId)).level);
  else await revokeGrants(relay, bot.bot_user_id);
}

/**
 * Before the agent's bot posts in a thread: a private conversation's thread takes it as a member first, since a bot without
 * Manage Threads sees only the private threads it was added to. Says whether the bot can post there; if not, the message goes
 * through the webhook. revokeGrants takes the bot out again once the agent leaves or the bot stops being used.
 */
export async function readyForThread(relay: Relay, botUserId: string, threadId: string): Promise<boolean> {
  const thread = await relay.db.prepare('SELECT private FROM threads WHERE id = ?').bind(threadId).first<{ private: number }>();
  if (!thread?.private) return true;
  await grant(relay, botUserId, threadId);
  try {
    await relay.discord.addThreadMember(threadId, botUserId);
    return true;
  } catch (error) {
    relay.log.warn('bots.thread_join_failed', { bot_user_id: botUserId, thread_id: threadId, error });
    return false;
  }
}

/** Takes the bot out of a private conversation's thread, opening an archived one for the moment. Says whether it is out. */
async function leaveThread(relay: Relay, botUserId: string, threadId: string): Promise<boolean> {
  const archived = (await relay.db.prepare('SELECT archived FROM threads WHERE id = ?').bind(threadId).first<{ archived: number }>())?.archived;
  try {
    if (archived) await relay.discord.setThreadArchived(threadId, false);
    await relay.discord.removeThreadMember(threadId, botUserId);
    if (archived) await relay.discord.setThreadArchived(threadId, true);
    return true;
  } catch (error) {
    if (error instanceof DiscordError && (error.code === UNKNOWN_CHANNEL || error.code === UNKNOWN_MEMBER)) return true;
    relay.log.warn('bots.thread_leave_failed', { bot_user_id: botUserId, thread_id: threadId, error });
    return false;
  }
}

/** A grant its bot no longer warrants: the roles of a bot that isn't active, or a thread its active bot's agent isn't in. */
const UNWARRANTED = `NOT EXISTS (
  SELECT 1 FROM agent_bots b WHERE b.bot_user_id = g.bot_user_id AND b.status = 'active' AND (g.thread_id = '' OR EXISTS (
    SELECT 1 FROM conversation_members m WHERE m.agent_id = b.agent_id AND m.thread_id = g.thread_id AND m.joined_at IS NOT NULL AND m.left_at IS NULL)))`;

/**
 * Takes back what bots no longer warrant (one bot's, or any): the roles of a paused, replaced or removed bot, and private
 * threads its agent left. A grant is forgotten only once Discord confirms the access is gone, so botsJob retries the rest,
 * untried grants first and then the longest since their last try. It only ever takes away, so it never puts a bot back to work.
 */
export async function revokeGrants(relay: Relay, botUserId?: string): Promise<number> {
  const { results } = await relay.db
    .prepare(
      `SELECT g.bot_user_id, g.thread_id FROM bot_grants g WHERE (?1 IS NULL OR g.bot_user_id = ?1) AND ${UNWARRANTED} ORDER BY g.attempted_at NULLS FIRST, g.created_at LIMIT ?2`,
    )
    .bind(botUserId ?? null, REVOKES_PER_RUN)
    .all<{ bot_user_id: string; thread_id: string }>();
  for (const g of results) {
    const gone = g.thread_id === ROLES ? await syncRolesOf(relay, g.bot_user_id, null) : await leaveThread(relay, g.bot_user_id, g.thread_id);
    if (gone)
      await relay.db
        .prepare(`DELETE FROM bot_grants AS g WHERE g.bot_user_id = ? AND g.thread_id = ? AND ${UNWARRANTED}`)
        .bind(g.bot_user_id, g.thread_id)
        .run();
    else
      await relay.db
        .prepare('UPDATE bot_grants SET attempted_at = ? WHERE bot_user_id = ? AND thread_id = ?')
        .bind(iso(relay.now()), g.bot_user_id, g.thread_id)
        .run();
  }
  return results.length;
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
  await revokeGrants(relay, bot.bot_user_id);
}

/** Pauses the agent's bot after Discord refused its token mid-send; the message goes out through the webhook instead. */
export async function tokenRefused(relay: Relay, agentId: string): Promise<void> {
  const bot = await getBot(relay, agentId);
  if (bot) await pause(relay, bot, TOKEN_REFUSED);
}

/**
 * Asks Discord which servers the bot is in and whether it is public, and moves it on: active once staff added it, paused when
 * public, in another server or without a working token.
 */
async function check(relay: Relay, bot: BotRow): Promise<void> {
  const guildId = relay.config.discord.guildId!;
  const rest = await clientOf(relay, bot);
  let guilds: PartialGuild[];
  let app: CurrentApplication;
  try {
    [guilds, app] = await Promise.all([rest.getCurrentUserGuilds(), rest.getCurrentApplication()]);
  } catch (error) {
    if (error instanceof DiscordError && error.status === 401) return pause(relay, bot, TOKEN_REFUSED);
    relay.log.warn('bots.check_failed', { agent_id: bot.agent_id, error });
    await relay.db.prepare('UPDATE agent_bots SET checked_at = ? WHERE agent_id = ?').bind(iso(relay.now()), bot.agent_id).run();
    return;
  }
  if (app.bot_public !== false) return pause(relay, bot, MADE_PUBLIC);
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

/**
 * Cron. Takes back what bots no longer warrant, then checks the bots that are due: waiting ones every run, active ones every
 * quarter hour. Returns how many grants and bots it went through.
 */
export async function botsJob(relay: Relay, ctx: { deadline: number }): Promise<number> {
  if (!relay.config.discord.guildId) return 0;
  const revoked = await revokeGrants(relay);
  const now = relay.now().getTime();
  const { results } = await relay.db
    .prepare("SELECT * FROM agent_bots WHERE (status = 'waiting' AND checked_at <= ?) OR (status = 'active' AND checked_at <= ?) ORDER BY checked_at LIMIT ?")
    .bind(iso(new Date(now - WAITING_CHECK_MS)), iso(new Date(now - ACTIVE_CHECK_MS)), CHECKS_PER_RUN)
    .all<BotRow>();
  let done = revoked;
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
