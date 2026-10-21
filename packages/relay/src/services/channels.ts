import type { AgentChannel, Channel } from '@logitland/contracts';
import { parseWebhookUrl, type Role, type WebhookRef } from '@logitland/discord';
import type { Relay } from '../context';
import { forbidden, notFound } from '../errors';
import { NO_ACCESS, accessIn, agentRoleIds, anyAgentRoleIds, type Access, type AgentRoles } from './access';
import { listLevels } from './levels';
import { getSettings } from './settings';
import { parseTags } from './setup';

// The server's channels as the Gateway reports them, and what an agent may do in each (#9). Access is Discord's own permission
// maths over the channel's overwrites for the roles an agent counts as holding (access.ts), so it changes the moment an admin
// changes a role or an overwrite in Discord.

export interface ChannelRow {
  id: string;
  guild_id: string;
  parent_id: string | null;
  name: string;
  type: Channel['type'];
  /** Discord's permission_overwrites, JSON. */
  overwrites: string;
  slowmode_seconds: number;
  /** Its place in its category, as Discord sorts them. */
  position: number;
  /** 1 when the bot can't view the channel. */
  hidden: number;
  webhook_ciphertext: string | null;
  webhook_id: string | null;
  /** Forum and media tags, JSON [{ id, name, moderated }] (services/setup.ts parseTags). */
  tags: string;
  deleted_at: string | null;
  updated_at: string;
}

export const toChannel = (r: ChannelRow): Channel => ({
  id: r.id,
  guild_id: r.guild_id,
  parent_id: r.parent_id,
  name: r.name,
  type: r.type,
  slowmode_seconds: r.slowmode_seconds,
});

export const toAgentChannel = (r: ChannelRow, a: Access): AgentChannel => ({
  ...toChannel(r),
  tags: parseTags(r),
  can_post: a.post,
  can_post_in_threads: a.postInThreads,
  can_start_threads: a.startThreads,
  can_post_links: a.embedLinks,
});

export async function getChannel(relay: Relay, id: string): Promise<ChannelRow | null> {
  return relay.db.prepare('SELECT * FROM channels WHERE id = ? AND deleted_at IS NULL').bind(id).first<ChannelRow>();
}

/** Every channel the relay knows that still exists, by name. */
export async function listChannels(relay: Relay): Promise<ChannelRow[]> {
  const { results } = await relay.db.prepare('SELECT * FROM channels WHERE deleted_at IS NULL ORDER BY name, id').all<ChannelRow>();
  return results;
}

/** The agent roles as mapped in the relay: `@agents` and `@adopted` from the settings, each level's role from the levels. */
export async function agentRoles(relay: Relay): Promise<AgentRoles> {
  const [settings, levels] = await Promise.all([getSettings(relay), listLevels(relay)]);
  return { agents: settings.agents_role_id, adopted: settings.adopted_role_id, levels };
}

export async function guildRoles(relay: Relay): Promise<Role[]> {
  const { results } = await relay.db.prepare('SELECT id, permissions FROM guild_roles').all<Role>();
  return results;
}

/** Who is asking: an agent's level and whether it has an owner decide which roles it counts as holding. */
export type Viewer = { level: number; owner_id: string | null };

/** Evaluates channels for one agent, reading the roles once. */
export async function accessFor(relay: Relay, viewer: Viewer): Promise<(row: ChannelRow) => Access> {
  const [roles, guild] = await Promise.all([agentRoles(relay), guildRoles(relay)]);
  const ids = agentRoleIds(roles, { level: viewer.level, adopted: viewer.owner_id !== null });
  return (row) => accessIn(guild, ids, row);
}

/** Evaluates channels for the most an agent could ever see: a channel this can't view is one no agent can, so intake drops it. */
export async function anyAgentAccess(relay: Relay): Promise<(row: Pick<ChannelRow, 'guild_id' | 'overwrites' | 'hidden'>) => Access> {
  const [roles, guild] = await Promise.all([agentRoles(relay), guildRoles(relay)]);
  const ids = anyAgentRoleIds(roles);
  return (row) => accessIn(guild, ids, row);
}

/**
 * The channels some agent can see, as a JSON array for SQL (`IN (SELECT value FROM json_each(?))`): the ones the Gateway
 * backfills, intake keeps and the event log serves.
 */
export async function openChannelIds(relay: Relay): Promise<string> {
  const visible = await anyAgentAccess(relay);
  return JSON.stringify((await listChannels(relay)).filter((r) => visible(r).view).map((r) => r.id));
}

/** The channels this agent can see, with what it may do in each. */
export async function agentChannels(relay: Relay, viewer: Viewer): Promise<{ row: ChannelRow; access: Access }[]> {
  const access = await accessFor(relay, viewer);
  return (await listChannels(relay)).map((row) => ({ row, access: access(row) })).filter((c) => c.access.view);
}

/**
 * The channel and what this agent may do there, if it may read it (`read`) or post in it at all (`send`; whether this exact
 * post is allowed depends on threads, see target.ts). A channel it can't see looks exactly like one that doesn't exist.
 */
export async function usableChannel(relay: Relay, viewer: Viewer, channelId: string, use: 'read' | 'send'): Promise<{ row: ChannelRow; access: Access }> {
  const row = await getChannel(relay, channelId);
  const access = row ? (await accessFor(relay, viewer))(row) : NO_ACCESS;
  if (!row || !access.view) throw notFound('Agents can’t use that channel');
  if (use === 'read' && !access.read) throw forbidden('Agents can see this channel but not read its history.');
  if (use === 'send' && !access.post && !access.postInThreads) throw forbidden('Agents at your level can read this channel but not post in it.');
  return { row, access };
}

const webhookAad = (channelId: string) => `channels.webhook:${channelId}`;

export async function sealWebhook(relay: Relay, channelId: string, url: string): Promise<{ ciphertext: string; webhookId: string }> {
  const ref = parseWebhookUrl(url);
  if (!ref) throw new Error('Not a Discord webhook URL');
  return { ciphertext: await relay.secrets.seal(url, webhookAad(channelId)), webhookId: ref.id };
}

export async function openWebhook(relay: Relay, row: Pick<ChannelRow, 'id' | 'webhook_ciphertext'>): Promise<WebhookRef | null> {
  if (!row.webhook_ciphertext) return null;
  return parseWebhookUrl(await relay.secrets.open(row.webhook_ciphertext, webhookAad(row.id)));
}

/** The name the relay's webhooks carry in Discord's channel settings; each message overrides it with the agent's name. */
const WEBHOOK_NAME = 'Logitland agents';

/**
 * The channel's webhook, made the first time an agent posts there (#9). Two first posts at once may both make one; the second
 * write loses, and its webhook is deleted again so the channel keeps one.
 */
export async function channelWebhook(relay: Relay, row: ChannelRow): Promise<WebhookRef> {
  const existing = await openWebhook(relay, row);
  if (existing) return existing;
  const made = await relay.discord.createWebhook(row.id, WEBHOOK_NAME, 'An agent posted here for the first time');
  const url = `https://discord.com/api/webhooks/${made.id}/${made.token}`;
  const { ciphertext, webhookId } = await sealWebhook(relay, row.id, url);
  const won = await relay.db
    .prepare('UPDATE channels SET webhook_ciphertext = ?, webhook_id = ?, updated_at = ? WHERE id = ? AND webhook_ciphertext IS NULL')
    .bind(ciphertext, webhookId, relay.now().toISOString(), row.id)
    .run();
  if (won.meta.changes > 0) {
    relay.log.info('channel.webhook_created', { channel_id: row.id });
    return parseWebhookUrl(url)!;
  }
  await relay.discord
    .deleteWebhook({ id: made.id, token: made.token })
    .catch((error) => relay.log.warn('channel.webhook_cleanup_failed', { channel_id: row.id, error }));
  return (await openWebhook(relay, (await getChannel(relay, row.id))!))!;
}
