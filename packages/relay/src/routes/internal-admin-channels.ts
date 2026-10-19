import { ChannelPatch, type Channel, type ChannelType } from '@logitland/contracts';
import { DiscordError, parseWebhookUrl } from '@logitland/discord';
import { iso, type Relay, type Stmt } from '../context';
import { RelayError, conflict, invalid, parse } from '../errors';
import { auditStmt, audit } from '../services/audit';
import { getChannel, listChannels, sealWebhook, toChannel } from '../services/channels';
import { body, type RegisterRoutes } from './shared';

// Which Discord channels agents can use, how, and whether they are mirrored publicly.
// https://docs.discord.com/developers/resources/channel#channel-object-channel-types

const DISCORD_TYPES: Record<number, ChannelType> = { 0: 'text', 5: 'announcement', 15: 'forum', 16: 'media' };

const unprocessable = (detail: string) => new RelayError(422, 'invalid_request', detail);

/** Asks Discord and turns its refusals into plain advice, without passing its error text on. */
async function askDiscord<T>(relay: Relay, what: 'channel' | 'webhook', call: () => Promise<T>): Promise<T> {
  try {
    return await call();
  } catch (err) {
    const status = err instanceof DiscordError ? err.status : 0;
    relay.log.warn('admin.discord_lookup_failed', { what, status });
    if (status >= 400 && status < 500 && status !== 429) {
      throw unprocessable(
        what === 'channel'
          ? 'Discord won’t show that channel to the relay. Check the ID, and that the bot is in the server and can see the channel.'
          : 'Discord doesn’t recognise that webhook. It may have been deleted: copy a fresh URL from the channel’s Integrations settings.',
      );
    }
    throw new RelayError(502, 'internal', `Couldn’t reach Discord to check the ${what}. Try again in a minute.`);
  }
}

/** A new channel needs a name, guild and type: whatever the admin left out comes from Discord. */
async function newChannelIdentity(relay: Relay, channelId: string, patch: ChannelPatch) {
  if (patch.name && patch.guild_id && patch.type) return { name: patch.name, guild_id: patch.guild_id, type: patch.type };
  const found = await askDiscord(relay, 'channel', () => relay.discord.getChannel(channelId));
  const type = patch.type ?? DISCORD_TYPES[found.type];
  if (!type)
    throw unprocessable(
      'The relay can only use text, announcement, forum and media channels. That one is a different kind (a thread, voice channel or category).',
    );
  return { name: patch.name ?? found.name, guild_id: patch.guild_id ?? found.guild_id, type };
}

export async function patchChannel(relay: Relay, adminId: string, channelId: string, patch: ChannelPatch): Promise<{ channel: Channel; created: boolean }> {
  const before = await getChannel(relay, channelId);
  const current = before ?? (await newChannelIdentity(relay, channelId, patch));
  const next = {
    name: patch.name ?? current.name,
    guild_id: patch.guild_id ?? current.guild_id,
    type: patch.type ?? current.type,
    agent_access: patch.agent_access ?? before?.agent_access ?? 'off',
    pace_per_agent_per_minute: patch.pace_per_agent_per_minute ?? before?.pace_per_agent_per_minute ?? 10,
    public_mirror: patch.public_mirror ?? before?.public_mirror === 1,
  };
  if (next.agent_access === 'post_new_threads' && next.type !== 'forum' && next.type !== 'media') {
    throw unprocessable(`post_new_threads is only for forum and media channels, and this is a ${next.type} channel. Use post, or change the channel type.`);
  }

  let webhook: { ciphertext: string; webhookId: string } | null | undefined;
  if (patch.webhook_url) {
    const ref = parseWebhookUrl(patch.webhook_url);
    if (!ref) throw invalid('That isn’t a Discord webhook URL. Copy it from the channel’s Integrations settings.');
    const info = await askDiscord(relay, 'webhook', () => relay.discord.getWebhook(ref));
    if (info.channel_id !== channelId)
      throw unprocessable('That webhook posts to a different channel. Create or copy the webhook from this channel’s own Integrations settings.');
    webhook = await sealWebhook(relay, channelId, patch.webhook_url);
  } else if (patch.clear_webhook) {
    webhook = null;
  }

  const diff: Record<string, { from: unknown; to: unknown }> = {};
  const was: Record<string, unknown> = before ? { ...before, public_mirror: before.public_mirror === 1 } : {};
  for (const key of ['name', 'guild_id', 'type', 'agent_access', 'pace_per_agent_per_minute', 'public_mirror'] as const) {
    if (was[key] !== next[key]) diff[key] = { from: was[key] ?? null, to: next[key] };
  }
  // Never the URL itself: only whether one is set.
  if (webhook) diff.webhook = { from: before?.webhook_ciphertext ? 'set' : null, to: before?.webhook_ciphertext ? 'replaced' : 'set' };
  else if (webhook === null && before?.webhook_ciphertext) diff.webhook = { from: 'set', to: null };
  if (before && Object.keys(diff).length === 0) return { channel: toChannel(before), created: false };

  const ciphertext = webhook === undefined ? (before?.webhook_ciphertext ?? null) : (webhook?.ciphertext ?? null);
  const webhookId = webhook === undefined ? (before?.webhook_id ?? null) : (webhook?.webhookId ?? null);
  const now = iso(relay.now());
  const entry = {
    actor_type: 'admin',
    actor_id: adminId,
    action: before ? 'channel.updated' : 'channel.added',
    target_type: 'channel',
    target_id: channelId,
    diff,
  } as const;
  const write: Stmt = before
    ? relay.db
        .prepare(
          'UPDATE channels SET guild_id = ?, name = ?, type = ?, agent_access = ?, pace_per_agent_per_minute = ?, public_mirror = ?, webhook_ciphertext = ?, webhook_id = ?, updated_at = ? WHERE id = ?',
        )
        .bind(
          next.guild_id,
          next.name,
          next.type,
          next.agent_access,
          next.pace_per_agent_per_minute,
          Number(next.public_mirror),
          ciphertext,
          webhookId,
          now,
          channelId,
        )
    : relay.db
        .prepare(
          'INSERT INTO channels (id, guild_id, name, type, agent_access, pace_per_agent_per_minute, public_mirror, webhook_ciphertext, webhook_id, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT (id) DO NOTHING',
        )
        .bind(
          channelId,
          next.guild_id,
          next.name,
          next.type,
          next.agent_access,
          next.pace_per_agent_per_minute,
          Number(next.public_mirror),
          ciphertext,
          webhookId,
          now,
        );
  if (before) {
    await relay.db.batch([write, auditStmt(relay, entry)]);
  } else {
    if ((await write.run()).meta.changes === 0) throw conflict('Someone just added that channel. Reload and check its settings.');
    await audit(relay, entry);
  }
  relay.log.info(before ? 'channel.updated' : 'channel.added', { channel: channelId, fields: Object.keys(diff).join(',') });
  return { channel: toChannel((await getChannel(relay, channelId))!), created: !before };
}

export const register: RegisterRoutes = (app, relay) => {
  app.get('/internal/admin/channels', async (c) => c.json({ channels: (await listChannels(relay)).map(toChannel) }));

  app.patch('/internal/admin/channels/:channelId', async (c) => {
    const channelId = c.req.param('channelId');
    if (!/^\d{17,20}$/.test(channelId)) throw invalid('Channel IDs are Discord snowflakes: 17 to 20 digits.');
    const patch = parse(ChannelPatch, await body(c));
    const { channel, created } = await patchChannel(relay, c.get('admin').id, channelId, patch);
    return c.json(channel, created ? 201 : 200);
  });
};
