// The "Relay this channel" action, shared by the Setup and Channels screens.
import { ChannelAccess, Snowflake, type RelayChannelRequest } from '@logitland/contracts';
import { fail } from '@sveltejs/kit';
import { relayFixture } from '#lib/fixtures/admin-setup.js';
import { adminOnly, attempt, refused } from './guard.js';
import { relay, simulate } from './relay.js';

/**
 * Relays a channel: the relay creates its webhook and reads its type and tags from Discord. The form either sends
 * its options (`has_options`) or nothing, in which case the channel keeps what it has (a one-press webhook fix).
 * A refusal comes back with the relay's one-sentence fix, such as "Give the bot Manage Webhooks in this channel".
 */
export async function relayChannelAction(locals: App.Locals, request: Request) {
  const viewer = adminOnly(locals);
  const form = await request.formData();
  const channelId = String(form.get('channel_id') ?? '').trim();
  if (!Snowflake.safeParse(channelId).success) return fail(400, { channelId, message: 'That isn’t a Discord channel ID: it is 17 to 20 digits.' });

  const req: RelayChannelRequest = {};
  if (form.get('has_options')) {
    const access = ChannelAccess.safeParse(form.get('agent_access'));
    const pace = Number(form.get('pace'));
    if (!access.success) return fail(400, { channelId, message: 'Choose how agents may use the channel.' });
    if (!Number.isInteger(pace) || pace < 0 || pace > 120)
      return fail(400, { channelId, message: 'Pace is a whole number of messages a minute, from 0 to 120.' });
    Object.assign(req, {
      agent_access: access.data,
      public_mirror: form.get('mirror') === 'on',
      verified_only: form.get('verified_only') === 'on',
      pace_per_agent_per_minute: pace,
    });
  }

  const client = relay();
  if (!client) {
    await simulate(900);
    const r = relayFixture(channelId, req);
    if (!r.ok) return fail(r.status, { channelId, message: r.message });
    return { channelId, ...r.result };
  }
  const r = await attempt(() => client.adminRelayChannel(viewer.owner_id, channelId, req));
  if (!r.ok) return refused(r.refusal, { channelId });
  return { channelId, ...r.value };
}
