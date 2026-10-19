import type { ChannelAccess } from '@logitland/contracts';
import { seeded } from '@logitland/flock';
import { error, fail } from '@sveltejs/kit';
import { CHANNELS, NEW_CHANNEL, SELECTED, type AccessMode, type AdminChannel } from '#lib/fixtures/admin-channels.js';
import { RelayRequestError, relay, simulate } from '#lib/server/relay.js';

const MODE_OF: Record<ChannelAccess, AccessMode> = { off: 'off', read_only: 'read', post: 'post', post_new_threads: 'post' };

export async function load({ parent }) {
  const { viewer } = await parent();
  const client = relay();
  if (!client) return { live: false, channels: CHANNELS, selected: SELECTED, newChannel: NEW_CHANNEL as typeof NEW_CHANNEL | null };

  // Relay mode: access, pace and whether a webhook is set are real. The relay doesn't report channel types,
  // its own Discord permissions, audience sizes or newly created channels yet, so those lines, the
  // permission checks and the "New in Discord" card stay fixtures (left out here). A channel that lets
  // agents start threads is treated as a forum.
  const { channels } = await client.adminChannels(viewer.owner_id);
  const rows = channels.map(
    (c): AdminChannel => ({
      id: c.id,
      name: `#${c.name}`,
      forum: c.agent_access === 'post_new_threads',
      locked: false,
      mode: MODE_OF[c.agent_access],
      pace: c.pace_per_agent_per_minute,
      newPosts: c.agent_access === 'post_new_threads',
      replies: c.agent_access === 'post_new_threads',
      checks: [],
      // The relay never returns the webhook itself, only whether one is set.
      webhook: c.has_webhook ? 'Set' : null,
      hasWebhook: c.has_webhook,
    }),
  );
  return { live: true, channels: rows, selected: rows[0]?.id ?? '', newChannel: null };
}

function guard(locals: App.Locals) {
  // Actions don't run the admin layout's load, so check here too.
  if (!locals.viewer?.is_admin) error(403, 'This console is for relay admins.');
  return locals.viewer;
}

function fromRelay(e: unknown, channelId: string, field?: string) {
  if (e instanceof RelayRequestError) return fail(e.status, { channelId, field, message: e.message });
  throw e;
}

export const actions = {
  save: async ({ request, locals }) => {
    const viewer = guard(locals);
    const form = await request.formData();
    const channelId = String(form.get('channel_id') ?? '');
    const raw = String(form.get('mode') ?? 'off');
    const mode: AccessMode = raw === 'read' || raw === 'post' ? raw : 'off';
    const forum = form.get('forum') === 'true';
    const pace = Math.min(120, Math.max(0, Math.round(Number(form.get('pace')) || 0)));
    // In a forum, "start new posts" is what lets agents open threads; without it they can only reply.
    const agent_access: ChannelAccess = mode === 'off' ? 'off' : mode === 'read' ? 'read_only' : forum && form.get('new-posts') === 'on' ? 'post_new_threads' : 'post';

    const client = relay();
    if (!client) {
      if (!CHANNELS.some((c) => c.id === channelId)) return fail(404, { channelId, field: undefined, message: 'No such channel' });
      await simulate(700);
      return { saved: channelId, mode, pace };
    }
    try {
      const ch = await client.adminPatchChannel(viewer.owner_id, channelId, { agent_access, pace_per_agent_per_minute: pace });
      return { saved: channelId, mode: MODE_OF[ch.agent_access], pace: ch.pace_per_agent_per_minute };
    } catch (e) {
      return fromRelay(e, channelId);
    }
  },

  webhook: async ({ request, locals }) => {
    const viewer = guard(locals);
    const form = await request.formData();
    const channelId = String(form.get('channel_id') ?? '');
    const name = String(form.get('name') ?? '');
    const created = form.get('has_webhook') !== 'true';

    const client = relay();
    if (!client) {
      // Fixtures mode: Discord would hand back a new webhook; make up its short ID.
      if (!CHANNELS.some((c) => c.id === channelId)) return fail(404, { channelId, field: undefined, message: 'No such channel' });
      await simulate(800);
      const r = seeded(name + Date.now());
      return { hooked: channelId, created, webhook: `wh_…${String(Math.floor(1000 + r() * 9000))}` };
    }
    const url = String(form.get('webhook_url') ?? '').trim();
    if (!url) return fail(400, { channelId, field: 'webhook_url', message: 'Paste the webhook URL from Discord.' });
    try {
      await client.adminPatchChannel(viewer.owner_id, channelId, { webhook_url: url });
    } catch (e) {
      return fromRelay(e, channelId, 'webhook_url');
    }
    return { hooked: channelId, created, webhook: 'Set' };
  },
};
