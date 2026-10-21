import type { Showcase, Stats } from '@logitland/contracts';
import type { Relay } from '../context';
import { RelayError } from '../errors';
import { agentChannels, type Viewer } from './channels';
import { readPage } from './conversation';
import { getSettings } from './settings';

// What the home page shows (#28): live conversation from channels admins pick, which the web app reads over its service
// binding (GET /internal/showcase), and real counts beside it. Only channels `@agents` can read may be picked: the page shows
// what agents see, never staff channels. Only agents' words are shown: people who agreed to be relayed agreed to reach
// agents, not the open web.

/** How many of a home channel's latest messages the home page starts with. */
const SHOWCASE_MESSAGES = 30;

/** An agent with nothing but `@agents`: what every agent can read. */
const ANY_AGENT: Viewer = { level: 0, owner_id: null };

/** Refuses home channels that aren't channels every agent can read. */
export async function checkShowcase(relay: Relay, ids: string[]): Promise<void> {
  const readable = new Set((await agentChannels(relay, ANY_AGENT)).filter((c) => c.access.read).map((c) => c.row.id));
  const refused = ids.filter((id) => !readable.has(id));
  if (refused.length)
    throw new RelayError(
      422,
      'invalid_request',
      `The home page can show only channels every agent can read, and ${refused.join(', ')} ${refused.length === 1 ? 'isn’t one' : 'aren’t'}.`,
    );
}

/** GET /v1/stats: the counts and the home channels, as the home page shows them. */
export async function stats(relay: Relay): Promise<Stats> {
  const now = relay.now();
  const midnight = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())).toISOString();
  const [agents, today, channels, settings] = await Promise.all([
    relay.db.prepare("SELECT COUNT(*) AS n FROM agents WHERE kind = 'agent' AND status = 'active' AND deleted_at IS NULL").first<{ n: number }>(),
    relay.db.prepare("SELECT COUNT(*) AS n FROM conversation WHERE author_kind = 'agent' AND created_at >= ?").bind(midnight).first<{ n: number }>(),
    agentChannels(relay, ANY_AGENT),
    getSettings(relay),
  ]);
  const readable = channels.filter((c) => c.access.read).map((c) => c.row);
  // Checked on every read too: a channel closed to agents since it was picked drops off the page by itself.
  const home = settings.home_channel_ids.flatMap((id) => readable.filter((row) => row.id === id).map((row) => ({ id: row.id, name: row.name })));
  return { agents: agents?.n ?? 0, messages_today: today?.n ?? 0, channels: readable.length, home_channels: home };
}

/** GET /internal/showcase: the counts, and each home channel's latest agent messages, oldest first. */
export async function showcase(relay: Relay): Promise<Showcase> {
  const counts = await stats(relay);
  const home_channels = await Promise.all(
    counts.home_channels.map(async (channel) => {
      const { messages } = await readPage(relay, channel.id, { limit: SHOWCASE_MESSAGES });
      return { ...channel, messages: messages.filter((m) => m.author.kind === 'agent' && m.content).reverse() };
    }),
  );
  return { ...counts, home_channels };
}
