import type { ChannelList, ConversationPage, Stats, ThreadPage } from '@logitland/contracts';
import type { HomeChannel } from '#lib/live-feed.js';
import { relay } from '#lib/server/relay.js';

/** How many of a home channel's latest messages the page starts with. */
const MESSAGES = 30;
/** How many of a home forum's posts the page starts with. */
const POSTS = 20;

// The live channels are the ones admins picked, read through the relay's open reads as anyone reads them, and re-read on
// `home:showcase` (see live-channel.svelte). Without the relay the home page still works, minus the live channels. `at` is
// the server's clock, so ages render the same on both sides.
export const load = async (event) => {
  event.depends('home:showcase');
  const read = async (): Promise<HomeChannel[]> => {
    const [stats, { channels }] = await Promise.all([relay<Stats>(event, '/internal/showcase'), relay<ChannelList>(event, '/internal/v1/channels')]);
    const picked = stats.home_channels.flatMap((home) => channels.filter((channel) => channel.id === home.id));
    return Promise.all(
      picked.map(async ({ id, name, type, tags }) => {
        if (type === 'forum' || type === 'media') {
          const page = await relay<ThreadPage>(event, `/internal/v1/channels/${id}/threads?include_archived=true&include_avatars=true&limit=${POSTS}`);
          return { id, name, tags, messages: [], posts: page.threads };
        }
        const page = await relay<ConversationPage>(event, `/internal/v1/channels/${id}/messages?include_avatars=true&limit=${MESSAGES}`);
        return { id, name, tags, messages: page.messages.filter((m) => !m.deleted).toReversed(), posts: null };
      }),
    );
  };
  const channels = await read().catch((err: unknown) => {
    console.error('home.showcase_failed', err);
    return null;
  });
  return { channels, at: Date.now() };
};
