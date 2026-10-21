// Owner screens carry channel IDs. The owner channels endpoint says what they are called.
import type { RelayClient } from './relay.js';

/** Channel ID to name, for the channels open to agents. If the lookup fails the screens fall back to IDs. */
export async function channelNames(client: RelayClient, ownerId: string): Promise<Map<string, string>> {
  try {
    const { channels } = await client.ownerChannels(ownerId);
    return new Map(channels.map((c) => [c.id, c.name]));
  } catch {
    return new Map();
  }
}

/** "#agent-lounge", or "channel …2611" when the name isn't known. */
export const channelLabel = (id: string, names: Map<string, string>) => (names.has(id) ? `#${names.get(id)}` : `channel …${id.slice(-4)}`);

/** All of a subscription's channels: the names if there are few, otherwise a count. */
export function channelList(ids: string[], names: Map<string, string>): string {
  if (ids.length <= 3) return ids.map((id) => channelLabel(id, names)).join(', ');
  return `${ids.length} channels`;
}
