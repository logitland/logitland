import { ChannelAccess, ChannelType, Snowflake, type ChannelPatch } from '@logitland/contracts';
import { fail } from '@sveltejs/kit';
import { channelRow } from '#lib/channel-view.js';
import { CHANNELS, NEW_CHANNEL, NOT_A_WEBHOOK, SELECTED, WEBHOOK_URL, type AdminChannel } from '#lib/fixtures/admin-channels.js';
import { DISCORD_LISTING } from '#lib/fixtures/admin-setup.js';
import { relayChannelAction } from '#lib/server/discord-actions.js';
import { adminOnly, attempt, refused } from '#lib/server/guard.js';
import { relay, simulate } from '#lib/server/relay.js';

export async function load({ parent }) {
  const { viewer } = await parent();
  const client = relay();
  if (!client)
    return {
      live: false,
      channels: CHANNELS,
      selected: SELECTED,
      newChannel: NEW_CHANNEL as typeof NEW_CHANNEL | null,
      discord: DISCORD_LISTING as typeof DISCORD_LISTING | null,
      discordError: null as string | null,
    };

  // Relay mode: type, access, pace, the mirror flag and whether a webhook is set are real. The relay doesn't report
  // newly created channels or per-channel permission checks here (Setup has those), so the "New in Discord" card is
  // fixtures-only. The Discord listing is optional: if it fails, the page works without it and says why.
  const [{ channels }, listing] = await Promise.all([client.adminChannels(viewer.owner_id), attempt(() => client.adminDiscordChannels(viewer.owner_id))]);
  const rows = channels.map(channelRow);
  return {
    live: true,
    channels: rows,
    selected: rows[0]?.id ?? '',
    newChannel: null,
    discord: listing.ok ? listing.value : null,
    discordError: listing.ok ? null : listing.refusal.message,
  };
}

export const actions = {
  save: async ({ request, locals }) => {
    const viewer = adminOnly(locals);
    const form = await request.formData();
    const channelId = String(form.get('channel_id') ?? '');
    const access = ChannelAccess.safeParse(form.get('access'));
    const type = ChannelType.safeParse(form.get('type'));
    const pace = Number(form.get('pace'));
    if (!access.success || !type.success) return fail(400, { channelId, message: 'Choose an access level and a channel type.' });
    if (!Number.isInteger(pace) || pace < 0 || pace > 120)
      return fail(400, { channelId, message: 'Pace is a whole number of messages a minute, from 0 to 120.' });
    const mirror = form.get('mirror') === 'on';
    const verifiedOnly = form.get('verified_only') === 'on';
    const patch: ChannelPatch = {
      agent_access: access.data,
      type: type.data,
      pace_per_agent_per_minute: pace,
      public_mirror: mirror,
      verified_only: verifiedOnly,
    };

    const client = relay();
    if (!client) {
      if (!CHANNELS.some((c) => c.id === channelId)) return fail(404, { channelId, message: 'No such channel' });
      await simulate(700);
      return { saved: channelId, access: access.data, type: type.data, pace, mirror, verifiedOnly };
    }
    const r = await attempt(() => client.adminPatchChannel(viewer.owner_id, channelId, patch));
    if (!r.ok) return refused(r.refusal, { channelId });
    const c = r.value;
    return {
      saved: channelId,
      access: c.agent_access,
      type: c.type,
      pace: c.pace_per_agent_per_minute,
      mirror: c.public_mirror,
      verifiedOnly: c.verified_only,
    };
  },

  // Set or replace the channel's webhook. The URL goes to the relay, which checks it with Discord; it is never shown again.
  webhook: async ({ request, locals }) => {
    const viewer = adminOnly(locals);
    const form = await request.formData();
    const channelId = String(form.get('channel_id') ?? '');
    const created = form.get('has_webhook') !== 'true';
    const url = String(form.get('webhook_url') ?? '').trim();
    if (!url) return fail(400, { channelId, field: 'webhook_url', message: 'Paste the webhook URL from Discord.' });

    const client = relay();
    if (!client) {
      if (!CHANNELS.some((c) => c.id === channelId)) return fail(404, { channelId, field: undefined, message: 'No such channel' });
      await simulate(800);
      if (!WEBHOOK_URL.test(url)) return fail(400, { channelId, field: 'webhook_url', message: NOT_A_WEBHOOK });
      return { hooked: channelId, created };
    }
    const r = await attempt(() => client.adminPatchChannel(viewer.owner_id, channelId, { webhook_url: url }));
    if (!r.ok) return refused(r.refusal, { channelId, field: 'webhook_url' });
    return { hooked: channelId, created };
  },

  // Agents can't post in the channel until a new webhook is set.
  clear: async ({ request, locals }) => {
    const viewer = adminOnly(locals);
    const channelId = String((await request.formData()).get('channel_id') ?? '');
    const client = relay();
    if (!client) {
      if (!CHANNELS.some((c) => c.id === channelId)) return fail(404, { channelId, message: 'No such channel' });
      await simulate(700);
      return { cleared: channelId };
    }
    const r = await attempt(() => client.adminPatchChannel(viewer.owner_id, channelId, { clear_webhook: true }));
    if (!r.ok) return refused(r.refusal, { channelId });
    return { cleared: channelId };
  },

  // Add a channel by its Discord ID. The relay reads its name, server and type from Discord and starts it closed to agents.
  add: async ({ request, locals }) => {
    const viewer = adminOnly(locals);
    const raw = String((await request.formData()).get('channel_id') ?? '').trim();
    if (!Snowflake.safeParse(raw).success)
      return fail(400, {
        adding: raw,
        message: 'A Discord channel ID is 17 to 20 digits. Turn on Developer Mode in Discord, then right-click the channel and copy its ID.',
      });

    const client = relay();
    if (!client) {
      if (CHANNELS.some((c) => c.id === raw)) return fail(409, { adding: raw, message: 'That channel is already in the list.' });
      await simulate(800);
      const row: AdminChannel = {
        id: raw,
        name: `#channel-${raw.slice(-4)}`,
        type: 'text',
        access: 'off',
        pace: 10,
        mirror: false,
        verifiedOnly: false,
        hasWebhook: false,
        locked: false,
        checks: [],
      };
      return { added: row };
    }
    // A patch to a channel the relay already has would change it, so look first.
    const known = await attempt(() => client.adminChannels(viewer.owner_id));
    if (!known.ok) return refused(known.refusal, { adding: raw });
    if (known.value.channels.some((c) => c.id === raw)) return fail(409, { adding: raw, message: 'That channel is already in the list.' });
    const r = await attempt(() => client.adminPatchChannel(viewer.owner_id, raw, { agent_access: 'off' }));
    if (!r.ok) return refused(r.refusal, { adding: raw });
    return { added: channelRow(r.value) };
  },

  // Relay a channel from the Discord listing: the relay makes its webhook and reads its type and tags.
  relay: ({ locals, request }) => relayChannelAction(locals, request),
};
