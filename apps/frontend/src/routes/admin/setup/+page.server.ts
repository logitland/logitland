import { Snowflake } from '@logitland/contracts';
import { fail } from '@sveltejs/kit';
import { COMMANDS, CONSENT_CHANNEL_TYPES, DISCORD_LISTING, SETUP_CHECKS, consentMessage } from '#lib/fixtures/admin-setup.js';
import { adminOnly, attempt, refused } from '#lib/server/guard.js';
import { relayChannelAction } from '#lib/server/discord-actions.js';
import { relay, simulate } from '#lib/server/relay.js';

export async function load({ parent }) {
  const { viewer } = await parent();
  const client = relay();
  if (!client) return { live: false, checks: SETUP_CHECKS, listing: DISCORD_LISTING as typeof DISCORD_LISTING | null, listingError: null as string | null };

  // Relay mode: the checklist runs in the relay (it asks Discord, so it takes a moment). The channel picker is optional:
  // if Discord's listing fails, the checklist still shows and the pickers say why they are missing.
  const [setup, listing] = await Promise.all([client.adminSetup(viewer.owner_id), attempt(() => client.adminDiscordChannels(viewer.owner_id))]);
  return { live: true, checks: setup.checks, listing: listing.ok ? listing.value : null, listingError: listing.ok ? null : listing.refusal.message };
}

export const actions = {
  // Put the /mirror command in the server.
  commands: async ({ locals }) => {
    const viewer = adminOnly(locals);
    const client = relay();
    if (!client) {
      await simulate(900);
      return { registered: COMMANDS.commands };
    }
    const r = await attempt(() => client.adminRegisterCommands(viewer.owner_id));
    if (!r.ok) return refused(r.refusal);
    return { registered: r.value.commands };
  },

  // Post the agree button's message in a text or announcement channel.
  consent: async ({ locals, request }) => {
    const viewer = adminOnly(locals);
    const channelId = String((await request.formData()).get('channel_id') ?? '').trim();
    if (!Snowflake.safeParse(channelId).success) return fail(400, { message: 'Pick the channel to post it in.' });
    const client = relay();
    if (!client) {
      const found = DISCORD_LISTING.channels.find((c) => c.id === channelId);
      if (!found || !(CONSENT_CHANNEL_TYPES as readonly string[]).includes(found.type))
        return fail(422, { message: 'Pick a text or announcement channel: the agree button can’t go in a forum or media channel.' });
      await simulate(900);
      return { posted: consentMessage(channelId), channelName: found.name };
    }
    const r = await attempt(() => client.adminPostConsentMessage(viewer.owner_id, channelId));
    if (!r.ok) return refused(r.refusal);
    return { posted: r.value, channelName: null };
  },

  relay: ({ locals, request }) => relayChannelAction(locals, request),
};
