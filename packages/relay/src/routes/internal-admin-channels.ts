import { ChannelPatch, type Channel, type ChannelTag, type ChannelType } from '@logitland/contracts';
import { parseWebhookUrl } from '@logitland/discord';
import type { Relay } from '../context';
import { invalid, parse } from '../errors';
import { getChannel, listChannels, sealWebhook, toChannel } from '../services/channels';
import {
  askDiscord,
  channelDiff,
  DEFAULT_PACE,
  mapTags,
  parseTags,
  saveChannel,
  unprocessable,
  type ChannelRowWithTags,
  type ChannelState,
  type WebhookChange,
} from '../services/setup';
import { body, type RegisterRoutes } from './shared';
import { register as registerSetup } from './internal-admin-setup';

// Which Discord channels agents can use, how, and whether they are mirrored publicly. The setup page's
// one-press “Relay” (internal-admin-setup.ts) is the easy way in; this PATCH is for fine adjustments.
// https://docs.discord.com/developers/resources/channel#channel-object-channel-types

const DISCORD_TYPES: Record<number, ChannelType> = { 0: 'text', 5: 'announcement', 15: 'forum', 16: 'media' };
const hasTags = (type: ChannelType) => type === 'forum' || type === 'media';

/** tags is null when Discord wasn't asked. */
interface Identity {
  name: string;
  guild_id: string;
  type: ChannelType;
  tags: ChannelTag[] | null;
}

/** A new channel needs a name, guild and type: whatever the admin left out comes from Discord, along with the channel's tags. */
async function newChannelIdentity(relay: Relay, channelId: string, patch: ChannelPatch): Promise<Identity> {
  if (patch.name && patch.guild_id && patch.type) return { name: patch.name, guild_id: patch.guild_id, type: patch.type, tags: null };
  const found = await askDiscord(
    relay,
    'check the channel',
    () => relay.discord.getChannel(channelId),
    () => 'Discord won’t show that channel to the relay. Check the ID, and that the bot is in the server and can see the channel.',
  );
  const type = patch.type ?? DISCORD_TYPES[found.type];
  if (!type)
    throw unprocessable(
      'The relay can only use text, announcement, forum and media channels. That one is a different kind (a thread, voice channel or category).',
    );
  return { name: patch.name ?? found.name, guild_id: patch.guild_id ?? found.guild_id, type, tags: hasTags(type) ? mapTags(found.available_tags) : [] };
}

/** Forum and media tags change in Discord without telling us, so saving the channel looks again. A Discord hiccup keeps the old tags rather than blocking the save. */
async function freshTags(relay: Relay, channelId: string, fallback: ChannelTag[]): Promise<ChannelTag[]> {
  try {
    const found = await relay.discord.getChannel(channelId);
    return found.available_tags ? mapTags(found.available_tags) : fallback;
  } catch (err) {
    relay.log.warn('admin.tags_refresh_failed', { channel: channelId, error: err });
    return fallback;
  }
}

export async function patchChannel(relay: Relay, adminId: string, channelId: string, patch: ChannelPatch): Promise<{ channel: Channel; created: boolean }> {
  const before = (await getChannel(relay, channelId)) as ChannelRowWithTags | null;
  const current: Identity = before
    ? { name: before.name, guild_id: before.guild_id, type: before.type, tags: parseTags(before) }
    : await newChannelIdentity(relay, channelId, patch);
  const next: ChannelState = {
    name: patch.name ?? current.name,
    guild_id: patch.guild_id ?? current.guild_id,
    type: patch.type ?? current.type,
    agent_access: patch.agent_access ?? before?.agent_access ?? 'off',
    pace_per_agent_per_minute: patch.pace_per_agent_per_minute ?? before?.pace_per_agent_per_minute ?? DEFAULT_PACE,
    public_mirror: patch.public_mirror ?? before?.public_mirror === 1,
    verified_only: patch.verified_only ?? before?.verified_only === 1,
    tags: current.tags ?? [],
  };
  const guildId = relay.config.discord.guildId;
  if (guildId && next.guild_id !== guildId) throw unprocessable('That channel isn’t in the Logitland server, so the relay won’t use it.');

  let webhook: WebhookChange;
  if (patch.webhook_url) {
    const ref = parseWebhookUrl(patch.webhook_url);
    if (!ref) throw invalid('That isn’t a Discord webhook URL. Copy it from the channel’s Integrations settings.');
    const info = await askDiscord(
      relay,
      'check the webhook',
      () => relay.discord.getWebhook(ref),
      () => 'Discord doesn’t recognise that webhook. It may have been deleted: copy a fresh URL from the channel’s Integrations settings.',
    );
    if (info.channel_id !== channelId)
      throw unprocessable('That webhook posts to a different channel. Create or copy the webhook from this channel’s own Integrations settings.');
    webhook = await sealWebhook(relay, channelId, patch.webhook_url);
  } else if (patch.clear_webhook) {
    webhook = null;
  }

  if (before && Object.keys(channelDiff(before, next, webhook)).length === 0) return { channel: toChannel(before), created: false };
  if (hasTags(next.type) && (before || current.tags === null)) next.tags = await freshTags(relay, channelId, next.tags);
  return saveChannel(relay, adminId, channelId, before, next, webhook);
}

export const register: RegisterRoutes = (app, relay) => {
  registerSetup(app, relay);

  app.get('/internal/admin/channels', async (c) => c.json({ channels: (await listChannels(relay)).map(toChannel) }));

  app.patch('/internal/admin/channels/:channelId', async (c) => {
    const channelId = c.req.param('channelId');
    if (!/^\d{17,20}$/.test(channelId)) throw invalid('Channel IDs are Discord snowflakes: 17 to 20 digits.');
    const patch = parse(ChannelPatch, await body(c));
    const { channel, created } = await patchChannel(relay, c.get('admin').id, channelId, patch);
    return c.json(channel, created ? 201 : 200);
  });
};
