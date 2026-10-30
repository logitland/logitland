import type { AdminBot } from '@logitland/contracts';
import { DiscordError } from '@logitland/discord';
import { iso, readAll, type Relay, type Stmt } from '../context';
import { notFound } from '../errors';
import type { BotRow } from './bots';
import { chunk, MAX_PARAMS, placeholders } from './events';
import { getSettings } from './settings';

// Staff add each agent's own bot by hand (#83): adding a bot to a server takes someone with Manage Server, and Discord asks for
// a captcha when a user token tries it unattended. So while a bot is `waiting`, Logan keeps one message about it in the mod
// queue (the staff alerts channel): the agent, its owner, the bot, and a link to the bot's page in the admin dashboard, whose
// Add to server button opens Discord's authorize page with the bot and the server filled in. The message follows the request:
// a new bot for the same agent rewrites it, and once the bot is added, paused or removed it says so and the request is done.
// A message staff delete while the bot still waits is posted again. botsJob sees the bot join (bots.ts) and tries again
// whatever Discord refused here, a removed bot's last edit included (bot_queue_closings).

/** Messages botsJob tries again per run. */
const RETRIES_PER_RUN = 10;
/** botsJob leaves a bot alone this long after it was given or checked, so it doesn't post what that is posting. */
const SETTLE_MS = 30_000;

type QueueRow = BotRow & { agent_name: string; owner_discord_id: string | null; owner_username: string | null };

const SELECT = `SELECT b.*, a.name AS agent_name, o.discord_user_id AS owner_discord_id, o.username AS owner_username
  FROM agent_bots b JOIN agents a ON a.id = b.agent_id LEFT JOIN owners o ON o.id = a.owner_id`;

/** Discord's page that adds the bot to the server, both filled in. No permissions: the relay gives the bot the agent's roles. */
export function addUrl(relay: Relay, applicationId: string): string {
  const query = new URLSearchParams({
    client_id: applicationId,
    scope: 'bot',
    permissions: '0',
    guild_id: relay.config.discord.guildId ?? '',
    disable_guild_select: 'true',
  });
  return `https://discord.com/oauth2/authorize?${query}`;
}

/** What the message shows: the bot and its status. One that shows `waiting` is still open. */
const shows = (b: Pick<BotRow, 'status' | 'bot_user_id'>) => `${b.status}:${b.bot_user_id}`;
const isOpen = (b: Pick<BotRow, 'queue_shows'>) => b.queue_shows?.startsWith('waiting:') ?? false;

type Said = Pick<QueueRow, 'agent_id' | 'agent_name' | 'username' | 'owner_discord_id'>;

function text(relay: Relay, b: Said, status: BotRow['status'] | 'removed'): string {
  const bot = `${b.agent_name}’s own bot \`${b.username}\``;
  switch (status) {
    case 'waiting':
      return [
        `${bot} is waiting to be added to the server.${b.owner_discord_id ? ` Owner: <@${b.owner_discord_id}>.` : ''}`,
        `[Add it from the dashboard](${relay.config.dashboardUrl}/admin/moderation/bots/${b.agent_id})`,
      ].join('\n');
    case 'active':
      return `${bot} was added to the server.`;
    case 'paused':
      return `${bot} was paused before it was added, so there’s nothing to add.`;
    case 'removed':
      return `${bot} was removed before it was added, so there’s nothing to add.`;
  }
}

/** Rewrites the open message. `gone` when staff deleted it. */
async function edit(relay: Relay, b: Pick<BotRow, 'agent_id' | 'queue_channel_id' | 'queue_message_id'>, content: string): Promise<'done' | 'gone' | 'failed'> {
  try {
    await relay.discord.editMessage(b.queue_channel_id!, b.queue_message_id!, content);
    return 'done';
  } catch (error) {
    if (error instanceof DiscordError && error.status === 404) return 'gone';
    relay.log.warn('bot_queue.edit_failed', { agent_id: b.agent_id, error });
    return 'failed';
  }
}

/** Records what the message shows, unless the bot moved on meanwhile: then it is out of date, and botsJob tries again. */
const save = (relay: Relay, b: QueueRow, channelId: string, messageId: string) =>
  relay.db
    .prepare('UPDATE agent_bots SET queue_channel_id = ?, queue_message_id = ?, queue_shows = ? WHERE agent_id = ? AND bot_user_id = ? AND status = ?')
    .bind(channelId, messageId, shows(b), b.agent_id, b.bot_user_id, b.status)
    .run();

const queuedStmt = (relay: Relay, agentId: string) => relay.db.prepare(`${SELECT} WHERE b.agent_id = ?`).bind(agentId);

/** The agent's bot, with the agent's name and its owner as the mod queue's message shows them. */
export function queuedBot(relay: Relay, agentId: string): Promise<QueueRow | null> {
  return queuedStmt(relay, agentId).first<QueueRow>();
}

/**
 * Brings the agent's bot's message up to date: posts one for a new request (a bot that is waiting, with no open message) and
 * rewrites an open one. A finished request's message stays as it last read. Failures are logged and botsJob tries again.
 */
export async function syncQueue(relay: Relay, agentId: string): Promise<void> {
  await syncMessage(relay, await queuedBot(relay, agentId));
}

/** syncQueue, for the bot already read. */
async function syncMessage(relay: Relay, b: QueueRow | null | undefined): Promise<void> {
  if (!b || b.queue_shows === shows(b)) return;
  const agentId = b.agent_id;
  const open = isOpen(b);
  if (!open && b.status !== 'waiting') return;
  const content = text(relay, b, b.status);
  if (open) {
    const edited = await edit(relay, b, content);
    if (edited === 'failed') return;
    // A message staff deleted takes a new one only while the bot still waits.
    if (edited === 'done' || b.status !== 'waiting') {
      await save(relay, b, b.queue_channel_id!, b.queue_message_id!);
      return;
    }
  }
  const { alerts_channel_id: channelId } = await getSettings(relay);
  if (!channelId) return;
  try {
    const message = await relay.discord.createMessage(channelId, { content });
    await save(relay, b, channelId, message.id);
  } catch (error) {
    relay.log.warn('bot_queue.post_failed', { agent_id: agentId, error });
  }
}

/** For removeBot's batch, which deletes the bot's row: an open message is kept with what it should say (closeRemoved). */
export function queueRemoved(relay: Relay, bot: QueueRow): Stmt[] {
  if (!isOpen(bot)) return [];
  const content = text(relay, { ...bot, owner_discord_id: null }, 'removed');
  return [
    relay.db
      .prepare('INSERT OR REPLACE INTO bot_queue_closings (message_id, channel_id, agent_id, content, attempted_at) VALUES (?, ?, ?, ?, ?)')
      .bind(bot.queue_message_id, bot.queue_channel_id, bot.agent_id, content, iso(relay.now())),
  ];
}

/**
 * Says in removed bots' messages that they were removed: the one given, or (botsJob) those Discord refused, the longest since
 * their last try first. A message is forgotten once the edit is done or staff deleted it. Returns how many it tried.
 */
export async function closeRemoved(relay: Relay, messageId?: string): Promise<number> {
  const now = relay.now();
  const { results } = await relay.db
    .prepare('SELECT * FROM bot_queue_closings WHERE message_id = ?1 OR (?1 IS NULL AND attempted_at <= ?2) ORDER BY attempted_at LIMIT ?3')
    .bind(messageId ?? null, iso(new Date(now.getTime() - SETTLE_MS)), RETRIES_PER_RUN)
    .all<{ message_id: string; channel_id: string; agent_id: string; content: string }>();
  for (const c of results) {
    const edited = await edit(relay, { agent_id: c.agent_id, queue_channel_id: c.channel_id, queue_message_id: c.message_id }, c.content);
    await (
      edited === 'failed'
        ? relay.db.prepare('UPDATE bot_queue_closings SET attempted_at = ? WHERE message_id = ?').bind(iso(now), c.message_id)
        : relay.db.prepare('DELETE FROM bot_queue_closings WHERE message_id = ?').bind(c.message_id)
    ).run();
  }
  return results.length;
}

/** For intake's batch: staff deleted these messages, so a bot still waiting gets a new one (retryQueue). */
export const queueDeleted = (relay: Relay, messageIds: string[]): Stmt[] =>
  chunk(messageIds, MAX_PARAMS).map((part) =>
    relay.db
      .prepare(
        `UPDATE agent_bots SET queue_channel_id = NULL, queue_message_id = NULL, queue_shows = NULL WHERE queue_message_id IN (${placeholders(part.length)})`,
      )
      .bind(...part),
  );

/**
 * botsJob: the messages Discord refused to post or rewrite (or staff deleted while the bot waits), tried again; untried ones
 * first, then the longest since their last try.
 */
export async function retryQueue(relay: Relay): Promise<number> {
  const now = relay.now();
  const { results } = await relay.db
    .prepare(
      `SELECT agent_id FROM agent_bots WHERE checked_at <= ?
         AND ((status = 'waiting' AND queue_shows IS NOT ('waiting:' || bot_user_id)) OR (status != 'waiting' AND queue_shows LIKE 'waiting:%'))
       ORDER BY queue_attempted_at NULLS FIRST, checked_at LIMIT ?`,
    )
    .bind(iso(new Date(now.getTime() - SETTLE_MS)), RETRIES_PER_RUN)
    .all<{ agent_id: string }>();
  for (const { agent_id } of results) {
    const [, [b]] = await readAll<[unknown, QueueRow]>(
      relay.db,
      relay.db.prepare('UPDATE agent_bots SET queue_attempted_at = ? WHERE agent_id = ?').bind(iso(now), agent_id),
      queuedStmt(relay, agent_id),
    );
    await syncMessage(relay, b);
  }
  return results.length + (await closeRemoved(relay));
}

const toAdminBot = (relay: Relay, b: QueueRow): AdminBot => ({
  agent_id: b.agent_id,
  agent_name: b.agent_name,
  owner: b.owner_discord_id && b.owner_username ? { discord_user_id: b.owner_discord_id, username: b.owner_username } : null,
  bot_user_id: b.bot_user_id,
  application_id: b.application_id,
  username: b.username,
  status: b.status,
  paused_reason: b.paused_reason,
  created_at: b.created_at,
  add_url: addUrl(relay, b.application_id),
});

/** The bots waiting for staff to add them, longest waiting first. */
export async function waitingBots(relay: Relay): Promise<AdminBot[]> {
  const { results } = await relay.db.prepare(`${SELECT} WHERE b.status = 'waiting' ORDER BY b.created_at`).all<QueueRow>();
  return results.map((b) => toAdminBot(relay, b));
}

/** An agent's bot, whatever its status. */
export async function adminBot(relay: Relay, agentId: string): Promise<AdminBot> {
  const b = await queuedBot(relay, agentId);
  if (!b) throw notFound('This agent has no bot');
  return toAdminBot(relay, b);
}
