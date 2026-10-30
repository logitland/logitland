import type { AgentChannel, Channel } from '@logitland/contracts';
import { parseWebhookUrl, type Role, type WebhookRef } from '@logitland/discord';
import { readAll, type Relay, type Stmt } from '../context';
import { forbidden, notFound } from '../errors';
import { once } from '../memo';
import { NO_ACCESS, accessIn, agentRoleIds, anyAgentRoleIds, type Access, type AgentRoles, type ChannelPermissionsRow } from './access';
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

/** getChannel as a statement, to read in one round trip with others (accessWith). */
export const channelStmt = (relay: Relay, id: string) => relay.db.prepare('SELECT * FROM channels WHERE id = ? AND deleted_at IS NULL').bind(id);

export async function getChannel(relay: Relay, id: string): Promise<ChannelRow | null> {
  return channelStmt(relay, id).first<ChannelRow>();
}

/** listChannels as a statement, to read in one round trip with others (accessWith). */
export const listChannelsStmt = (relay: Relay) => relay.db.prepare('SELECT * FROM channels WHERE deleted_at IS NULL ORDER BY name, id');

/** Every channel the relay knows that still exists, by name. */
export async function listChannels(relay: Relay): Promise<ChannelRow[]> {
  return (await listChannelsStmt(relay).all<ChannelRow>()).results;
}

/** The agent roles as mapped in the relay: `@agents` from the settings, each level's role from the levels. */
export async function agentRoles(relay: Relay): Promise<AgentRoles> {
  const [settings, levels] = await Promise.all([getSettings(relay), listLevels(relay)]);
  return { agents: settings.agents_role_id, levels };
}

const guildRolesStmt = (relay: Relay) => relay.db.prepare('SELECT id, permissions FROM guild_roles');

/** Every role's permissions, read once per unit of work. */
export function guildRoles(relay: Relay): Promise<Role[]> {
  return once(GUILD_ROLES, async () => (await guildRolesStmt(relay).all<Role>()).results);
}

/** What `guildRoles` keeps; a write to guild_roles forgets it. */
export const GUILD_ROLES = 'guild_roles';

/** Who is asking: an agent's level decides which roles it counts as holding. */
export type Viewer = { level: number };

/** An agent with nothing but `@agents`: what every agent can see, and so what anyone reading without a token sees. */
export const ANY_AGENT: Viewer = { level: 0 };

/** Evaluates channels for one agent, reading the roles once. */
export async function accessFor(relay: Relay, viewer: Viewer): Promise<(row: ChannelPermissionsRow) => Access> {
  const [roles, guild] = await Promise.all([agentRoles(relay), guildRoles(relay)]);
  const ids = agentRoleIds(roles, viewer);
  return (row) => accessIn(guild, ids, row);
}

/**
 * Reads the roles channel access needs in one round trip with `stmts`, and answers their rows with `accessOf`, which
 * evaluates channels for a viewer as accessFor does. guildRoles keeps the roles for the rest of the unit:
 * `const { accessOf, rows: [channels] } = await accessWith<[ChannelRow]>(relay, listChannelsStmt(relay))`.
 */
export async function accessWith<T extends unknown[]>(
  relay: Relay,
  ...stmts: { [K in keyof T]: Stmt }
): Promise<{ accessOf: (viewer: Viewer) => (row: ChannelPermissionsRow) => Access; rows: { [K in keyof T]: T[K][] } }> {
  const [[read, ...rows], roles] = await Promise.all([readAll<[Role, ...T]>(relay.db, guildRolesStmt(relay), ...stmts), agentRoles(relay)]);
  const guild = await once(GUILD_ROLES, async () => read);
  return {
    accessOf: (viewer) => {
      const ids = agentRoleIds(roles, viewer);
      return (row) => accessIn(guild, ids, row);
    },
    rows: rows as { [K in keyof T]: T[K][] },
  };
}

/** A viewer at the top level: it sees the most an agent ever could, so a channel it can't view is one no agent can. */
const TOP_AGENT: Viewer = { level: Number.MAX_SAFE_INTEGER };

/** Evaluates channels for the most an agent could ever see: a channel this can't view is one no agent can, so intake drops it. */
export async function anyAgentAccess(relay: Relay): Promise<(row: ChannelPermissionsRow) => Access> {
  const [roles, guild] = await Promise.all([agentRoles(relay), guildRoles(relay)]);
  const ids = anyAgentRoleIds(roles);
  return (row) => accessIn(guild, ids, row);
}

/**
 * The channels some agent can see, as a JSON array for SQL (`IN (SELECT value FROM json_each(?))`): the ones the Gateway
 * backfills, intake keeps and the event log serves.
 */
export async function openChannelIds(relay: Relay): Promise<string> {
  return JSON.stringify((await openChannels(relay)).map((r) => r.id));
}

/** The channels some agent can see. */
export async function openChannels(relay: Relay): Promise<ChannelRow[]> {
  const { accessOf, rows: [channels] } = await accessWith<[ChannelRow]>(relay, listChannelsStmt(relay));
  const visible = accessOf(TOP_AGENT);
  return channels.filter((r) => visible(r).view);
}

/** The channels this agent can see, with what it may do in each. */
export async function agentChannels(relay: Relay, viewer: Viewer): Promise<{ row: ChannelRow; access: Access }[]> {
  const { accessOf, rows: [channels] } = await accessWith<[ChannelRow]>(relay, listChannelsStmt(relay));
  const access = accessOf(viewer);
  return channels.map((row) => ({ row, access: access(row) })).filter((c) => c.access.view);
}

/**
 * The channel and what this agent may do there, if it may read it (`read`) or post in it at all (`send`; whether this exact
 * post is allowed depends on threads, see target.ts). A channel it can't see looks exactly like one that doesn't exist.
 */
export async function usableChannel(relay: Relay, viewer: Viewer, channelId: string, use: 'read' | 'send'): Promise<{ row: ChannelRow; access: Access }> {
  const { accessOf, rows: [[row]] } = await accessWith<[ChannelRow]>(relay, channelStmt(relay, channelId));
  return checkUsable(row ?? null, row ? accessOf(viewer)(row) : NO_ACCESS, use);
}

/** usableChannel's check, for a channel row and access already read. */
export function checkUsable(row: ChannelRow | null, access: Access, use: 'read' | 'send'): { row: ChannelRow; access: Access } {
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
 * write loses, and its webhook is deleted again so the channel keeps one. Discord allows 15 webhooks per channel, not per
 * server (measured on the staging server, #61), so one per channel never nears the cap.
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
