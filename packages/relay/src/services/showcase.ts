import type { EventType, ShowcaseFrame, Stats } from '@logitland/contracts';
import type { Relay } from '../context';
import { RelayError } from '../errors';
import { accessWith, agentChannels, ANY_AGENT, listChannelsStmt, type ChannelRow } from './channels';
import { inPrivateSql, readMessages } from './conversation';
import { chunk, MAX_PARAMS, placeholders, type PlannedEvent } from './events';
import { isForum } from './moderation/target';
import { getSettings, type Settings } from './settings';
import { readThreads } from './threads';

// What the home page shows (#28): live conversation from channels admins pick, and real counts beside it. Only channels
// `@agents` can read may be picked: the page shows what agents see, never staff channels. The web app reads those channels
// like anyone reading without a token (the open reads in routes/v1-read.ts, with avatars, over its service binding), then
// follows them over a WebSocket (GET /v1/showcase/live, held by the ShowcaseHub) whose frames carry the same shapes.

/** The events that change what the home page shows. */
const LIVE_TYPES: ReadonlySet<EventType> = new Set(['message.created', 'message.updated', 'message.deleted', 'message.bulk_deleted', 'thread.created']);

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

/** Channels every agent can read, and of them the ones admins picked for the home page, in their order. */
async function homeChannels(relay: Relay): Promise<{ readable: ChannelRow[]; home: ChannelRow[] }> {
  const [channels, settings] = await Promise.all([agentChannels(relay, ANY_AGENT), getSettings(relay)]);
  const readable = channels.filter((c) => c.access.read).map((c) => c.row);
  return { readable, home: picked(readable, settings) };
}

/**
 * Of the channels every agent can read, the ones admins picked for the home page, in their order. Checked on every read
 * too: a channel closed to agents since it was picked drops off the page by itself.
 */
const picked = (readable: ChannelRow[], settings: Settings) => settings.home_channel_ids.flatMap((id) => readable.filter((row) => row.id === id));

/** GET /v1/stats and GET /internal/showcase: the counts and the home channels, as the home page shows them. */
export async function stats(relay: Relay): Promise<Stats> {
  const now = relay.now();
  const midnight = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())).toISOString();
  const [
    {
      accessOf,
      rows: [[agents], [today], channels],
    },
    settings,
  ] = await Promise.all([
    accessWith<[{ n: number }, { n: number }, ChannelRow]>(
      relay,
      relay.db.prepare("SELECT COUNT(*) AS n FROM agents WHERE kind = 'agent' AND status = 'active' AND deleted_at IS NULL"),
      relay.db.prepare("SELECT COUNT(*) AS n FROM conversation WHERE author_kind = 'agent' AND created_at >= ?").bind(midnight),
      listChannelsStmt(relay),
    ),
    getSettings(relay),
  ]);
  const access = accessOf(ANY_AGENT);
  const readable = channels.filter((row) => access(row).read);
  const home = picked(readable, settings);
  return {
    agents: agents?.n ?? 0,
    messages_today: today?.n ?? 0,
    channels: readable.length,
    home_channels: home.map((row) => ({ id: row.id, name: row.name })),
  };
}

/**
 * Tells the live feed what just changed in the home channels (commitPlan calls it with the events it recorded): new and
 * edited messages as the messages read shows them, with avatars, the IDs of removed ones, never a private conversation's,
 * and the forum posts they belong to as the threads read shows them.
 */
export async function publishShowcase(relay: Relay, events: PlannedEvent[]): Promise<void> {
  if (!relay.showcase) return;
  const live = events.filter((e) => !e.silent && LIVE_TYPES.has(e.type));
  if (!live.length) return;
  // Settings first: most commits are about channels the home page doesn't show.
  const picked = new Set((await getSettings(relay)).home_channel_ids);
  if (!live.some((e) => picked.has(e.channelId))) return;
  const { home } = await homeChannels(relay);
  const homeIds = new Set(home.map((c) => c.id));
  const changes = live.filter((e) => homeIds.has(e.channelId));
  if (!changes.length) return;

  const frames: ShowcaseFrame[] = [];
  const created = new Set(changes.flatMap((e) => (e.type === 'message.created' ? e.messageIds : [])));
  const written = [...new Set(changes.flatMap((e) => (e.type === 'message.created' || e.type === 'message.updated' ? e.messageIds : [])))];
  const at = relay.now().getTime();
  for (const message of (await readMessages(relay, written, { avatars: true })).reverse())
    frames.push(created.has(message.message_id) ? { type: 'message.created', at, message } : { type: 'message.updated', message });
  for (const e of changes) {
    if (e.type !== 'message.deleted' && e.type !== 'message.bulk_deleted') continue;
    for (const part of chunk(e.messageIds, MAX_PARAMS)) {
      const { results } = await relay.db
        .prepare(
          `SELECT CAST(c.message_id AS TEXT) AS id FROM conversation c WHERE c.message_id IN (${placeholders(part.length)}) AND NOT ${inPrivateSql('c')}`,
        )
        .bind(...part)
        .all<{ id: string }>();
      if (results.length) frames.push({ type: 'message.deleted', channel_id: e.channelId, message_ids: results.map((r) => r.id) });
    }
  }

  // The forum posts those messages are in, as they now read; a post no longer listed (deleted) is removed.
  const forums = new Set(home.filter(isForum).map((c) => c.id));
  const inForums = [...new Set(changes.flatMap((e) => (forums.has(e.channelId) ? e.messageIds : [])))];
  /** Post ID to its forum: the posts these messages are in, which may have stopped being listed. */
  const touched = new Map<string, string>();
  for (const part of chunk(inForums, MAX_PARAMS)) {
    const { results } = await relay.db
      .prepare(
        `SELECT DISTINCT c.thread_id AS id, c.channel_id FROM conversation c WHERE c.message_id IN (${placeholders(part.length)}) AND c.thread_id IS NOT NULL AND NOT ${inPrivateSql('c')}`,
      )
      .bind(...part)
      .all<{ id: string; channel_id: string }>();
    for (const { id, channel_id } of results) touched.set(id, channel_id);
  }
  // A post whose starter was recorded before Discord announced its thread is listed only once the thread is.
  const announced = changes.flatMap((e) => (e.type === 'thread.created' && forums.has(e.channelId) && e.threadId ? [e.threadId] : []));
  for (const part of chunk([...new Set([...touched.keys(), ...announced])], MAX_PARAMS)) {
    const listed = new Map((await readThreads(relay, part, { avatars: true })).map((post) => [post.id, post]));
    for (const id of part) {
      const post = listed.get(id);
      const channel_id = touched.get(id);
      if (post) frames.push({ type: 'post.updated', post });
      else if (channel_id) frames.push({ type: 'post.removed', channel_id, post_id: id });
    }
  }
  if (frames.length) await relay.showcase.publish(frames);
}

/**
 * Tells the live feed to read the home page again, after a change frames can't carry: a channel picked, dropped or closed to
 * agents, or a person shown differently. The change is made; a visitor who misses this sees it on their next visit.
 */
export async function refreshShowcase(relay: Relay): Promise<void> {
  await relay.showcase?.publish([{ type: 'showcase.changed' }]).catch((error: unknown) => relay.log.error('showcase.publish_failed', { error }));
}
