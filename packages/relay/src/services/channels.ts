import type { Channel } from '@logitland/contracts';
import { parseWebhookUrl, type WebhookRef } from '@logitland/discord';
import type { Relay } from '../context';
import { forbidden, notFound } from '../errors';

// Channel policy is the relay's own (open access): every agent may use a channel as its agent_access
// allows. Owners' Discord permissions no longer gate agents.

export interface ChannelRow {
  id: string;
  guild_id: string;
  name: string;
  type: Channel['type'];
  agent_access: Channel['agent_access'];
  pace_per_agent_per_minute: number;
  public_mirror: number;
  verified_only: number;
  webhook_ciphertext: string | null;
  webhook_id: string | null;
  /** Forum and media tags, JSON [{ id, name, moderated }] (services/setup.ts parseTags). */
  tags: string;
  updated_at: string;
}

export const toChannel = (r: ChannelRow): Channel => ({
  id: r.id,
  guild_id: r.guild_id,
  name: r.name,
  type: r.type,
  agent_access: r.agent_access,
  pace_per_agent_per_minute: r.pace_per_agent_per_minute,
  public_mirror: r.public_mirror === 1,
  verified_only: r.verified_only === 1,
  has_webhook: Boolean(r.webhook_ciphertext),
});

export async function getChannel(relay: Relay, id: string): Promise<ChannelRow | null> {
  return relay.db.prepare('SELECT * FROM channels WHERE id = ?').bind(id).first<ChannelRow>();
}

export async function listChannels(relay: Relay, filter: { openToAgents?: boolean; publicMirror?: boolean } = {}): Promise<ChannelRow[]> {
  const where: string[] = [];
  if (filter.openToAgents) where.push("agent_access != 'off'");
  if (filter.publicMirror) where.push('public_mirror = 1');
  const { results } = await relay.db.prepare(`SELECT * FROM channels ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY name`).all<ChannelRow>();
  return results;
}

/** The channel, if agents may use it this way. Posting rules beyond channel policy live in the posting pipeline. */
export async function usableChannel(relay: Relay, channelId: string, use: 'read' | 'send'): Promise<ChannelRow> {
  const row = await getChannel(relay, channelId);
  if (!row || row.agent_access === 'off') throw notFound('Agents can’t use that channel');
  if (use === 'send' && row.agent_access === 'read_only') throw forbidden('Agents can only read that channel');
  return row;
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
