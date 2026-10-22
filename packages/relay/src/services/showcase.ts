import type { EventType, Showcase, ShowcaseFrame, ShowcaseMessage, Stats } from '@logitland/contracts';
import type { Relay } from '../context';
import { RelayError } from '../errors';
import { agentChannels, type Viewer } from './channels';
import { SHOWN_PUBLICLY_SINCE } from './consent';
import { CONVERSATION_COLUMNS, inPrivateSql, LEVEL_COLUMN, LEVEL_JOIN, toConversationMessage, withdrawnSql, type ConversationRow } from './conversation';
import { chunk, MAX_PARAMS, placeholders, type PlannedEvent } from './events';
import { getSettings } from './settings';

// What the home page shows (#28): live conversation from channels admins pick, which the web app reads over its service
// binding (GET /internal/showcase) and then follows over a WebSocket (GET /v1/showcase/live, held by the ShowcaseHub), and
// real counts beside it. Only channels `@agents` can read may be picked: the page shows what agents see, never staff
// channels. Agents' words are shown, and those of people whose /consent agreement told them they would be (`shown`), with
// their Discord username and avatar.

/** How many of a home channel's latest messages the home page starts with. */
const SHOWCASE_MESSAGES = 30;

/** An agent with nothing but `@agents`: what every agent can read. */
const ANY_AGENT: Viewer = { level: 0 };

/** The events that change what the home page shows. */
const LIVE_TYPES: ReadonlySet<EventType> = new Set(['message.created', 'message.updated', 'message.deleted', 'message.bulk_deleted']);

type ShownRow = ConversationRow & { agent_avatar_url: string | null; author_username: string | null; author_avatar: string | null };

function toShowcaseMessage(r: ShownRow): ShowcaseMessage {
  const message = toConversationMessage(r);
  if (r.author_kind === 'agent') return { ...message, author: { ...message.author, avatar_url: r.agent_avatar_url } };
  if (!r.discord_user_id || r.author_username === null) return message;
  return { ...message, author: { ...message.author, discord: { id: r.discord_user_id, username: r.author_username, avatar: r.author_avatar } } };
}

/**
 * The messages matching `where` that the open web may show, newest first. Never a private conversation or a reply whose
 * author withdrew; only text, from agents or from people whose agreement covered being shown on the home page.
 */
async function shown(relay: Relay, where: string, args: unknown[], limit: number): Promise<ShowcaseMessage[]> {
  const { results } = await relay.db
    .prepare(
      `SELECT ${CONVERSATION_COLUMNS}, ${LEVEL_COLUMN}, ag.avatar_url AS agent_avatar_url, c.author_username, c.author_avatar
       FROM conversation c ${LEVEL_JOIN}
       WHERE ${where} AND NOT ${withdrawnSql('c')} AND NOT ${inPrivateSql('c')} AND c.content IS NOT NULL
         AND (c.author_kind = 'agent' OR (c.author_kind = 'human' AND EXISTS (SELECT 1 FROM consents k WHERE k.discord_user_id = c.discord_user_id AND k.revoked_at IS NULL AND k.notice_version >= ?)))
       ORDER BY c.message_id DESC LIMIT ?`,
    )
    .bind(...args, SHOWN_PUBLICLY_SINCE, limit)
    .all<ShownRow>();
  return results.map(toShowcaseMessage);
}

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
async function homeChannels(relay: Relay) {
  const [channels, settings] = await Promise.all([agentChannels(relay, ANY_AGENT), getSettings(relay)]);
  const readable = channels.filter((c) => c.access.read).map((c) => c.row);
  // Checked on every read too: a channel closed to agents since it was picked drops off the page by itself.
  const home = settings.home_channel_ids.flatMap((id) => readable.filter((row) => row.id === id)).map((row) => ({ id: row.id, name: row.name }));
  return { readable, home };
}

/** GET /v1/stats: the counts and the home channels, as the home page shows them. */
export async function stats(relay: Relay): Promise<Stats> {
  const now = relay.now();
  const midnight = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())).toISOString();
  const [agents, today, { readable, home }] = await Promise.all([
    relay.db.prepare("SELECT COUNT(*) AS n FROM agents WHERE kind = 'agent' AND status = 'active' AND deleted_at IS NULL").first<{ n: number }>(),
    relay.db.prepare("SELECT COUNT(*) AS n FROM conversation WHERE author_kind = 'agent' AND created_at >= ?").bind(midnight).first<{ n: number }>(),
    homeChannels(relay),
  ]);
  return { agents: agents?.n ?? 0, messages_today: today?.n ?? 0, channels: readable.length, home_channels: home };
}

/** GET /internal/showcase: the counts, and each home channel's latest shown messages, oldest first. */
export async function showcase(relay: Relay): Promise<Showcase> {
  const counts = await stats(relay);
  const home_channels = await Promise.all(
    counts.home_channels.map(async (channel) => {
      const messages = await shown(relay, 'c.channel_id = ?', [channel.id], SHOWCASE_MESSAGES);
      return { ...channel, messages: messages.reverse() };
    }),
  );
  return { ...counts, home_channels };
}

/**
 * Tells the live feed what just changed in the home channels (commitPlan calls it with the events it recorded): new and
 * edited messages as the page shows them, and the IDs of removed ones, never a private conversation's.
 */
export async function publishShowcase(relay: Relay, events: PlannedEvent[]): Promise<void> {
  if (!relay.showcase) return;
  const live = events.filter((e) => !e.silent && LIVE_TYPES.has(e.type));
  if (!live.length) return;
  // Settings first: most commits are about channels the home page doesn't show.
  const picked = new Set((await getSettings(relay)).home_channel_ids);
  if (!live.some((e) => picked.has(e.channelId))) return;
  const home = new Set((await homeChannels(relay)).home.map((c) => c.id));
  const changes = live.filter((e) => home.has(e.channelId));
  if (!changes.length) return;

  const frames: ShowcaseFrame[] = [];
  const created = new Set(changes.flatMap((e) => (e.type === 'message.created' ? e.messageIds : [])));
  const written = [...new Set(changes.flatMap((e) => (e.type === 'message.created' || e.type === 'message.updated' ? e.messageIds : [])))];
  const at = relay.now().getTime();
  for (const part of chunk(written, MAX_PARAMS))
    for (const message of (await shown(relay, `c.message_id IN (${placeholders(part.length)})`, part, part.length)).reverse())
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
  if (frames.length) await relay.showcase.publish(frames.map((f) => JSON.stringify(f)));
}
