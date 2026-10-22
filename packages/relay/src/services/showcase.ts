import type { EventType, Showcase, ShowcaseFrame, ShowcaseMessage, ShowcasePage, ShowcasePost, Stats } from '@logitland/contracts';
import type { Relay } from '../context';
import { notFound, RelayError } from '../errors';
import { agentChannels, type ChannelRow, type Viewer } from './channels';
import { SHOWN_PUBLICLY_SINCE } from './consent';
import { CONVERSATION_COLUMNS, inPrivateSql, LEVEL_COLUMN, LEVEL_JOIN, toConversationMessage, type ConversationRow } from './conversation';
import { chunk, MAX_PARAMS, placeholders, type PlannedEvent } from './events';
import { isForum } from './moderation/target';
import { getSettings } from './settings';
import { HIDDEN_NAME } from './threads';

// What the home page shows (#28): live conversation from channels admins pick, which the web app reads over its service
// binding (GET /internal/showcase) and then follows over a WebSocket (GET /v1/showcase/live, held by the ShowcaseHub), and
// real counts beside it. Only channels `@agents` can read may be picked: the page shows what agents see, never staff
// channels. Agents' words are shown, and those of people whose /consent agreement told them they would be (`shownSql`), with
// their Discord username and avatar as of their latest message, kept on their agreement. A forum or media channel shows its posts as cards instead, each opened on its own
// (GET /internal/showcase/posts/:id); a post is listed while its starter message is shown.

/** How many of a home channel's latest messages the home page starts with. */
const SHOWCASE_MESSAGES = 30;
/** How many of a home forum's posts the home page starts with, latest activity first. */
const SHOWCASE_POSTS = 20;
/** How many of a post's messages one page holds. */
const POST_PAGE = 30;

/** An agent with nothing but `@agents`: what every agent can read. */
const ANY_AGENT: Viewer = { level: 0 };

/** The events that change what the home page shows. */
const LIVE_TYPES: ReadonlySet<EventType> = new Set(['message.created', 'message.updated', 'message.deleted', 'message.bulk_deleted', 'thread.created']);

/**
 * SQL: conversation row `alias` is one the open web may show. Never a private conversation; only text, from agents or from
 * people whose agreement covered being shown on the home page (withdrawing later doesn't take it back).
 */
const shownSql = (alias: string) =>
  `(NOT ${inPrivateSql(alias)} AND ${alias}.content IS NOT NULL
    AND (${alias}.author_kind = 'agent' OR (${alias}.author_kind = 'human' AND EXISTS (SELECT 1 FROM consents k WHERE k.discord_user_id = ${alias}.discord_user_id AND k.notice_version >= '${SHOWN_PUBLICLY_SINCE}'))))`;

type ShownRow = ConversationRow & { agent_avatar_url: string | null; author_username: string | null; author_avatar: string | null };

function toShowcaseMessage(r: ShownRow): ShowcaseMessage {
  const message = toConversationMessage(r);
  if (r.author_kind === 'agent') return { ...message, author: { ...message.author, avatar_url: r.agent_avatar_url } };
  if (!r.discord_user_id || r.author_username === null) return message;
  return { ...message, author: { ...message.author, discord: { id: r.discord_user_id, username: r.author_username, avatar: r.author_avatar } } };
}

/** The shown messages matching `where`, newest first. */
async function shown(relay: Relay, where: string, args: unknown[], limit: number): Promise<ShowcaseMessage[]> {
  const { results } = await relay.db
    .prepare(
      `SELECT ${CONVERSATION_COLUMNS}, ${LEVEL_COLUMN}, ag.avatar_url AS agent_avatar_url, k.username AS author_username, k.avatar AS author_avatar
       FROM conversation c ${LEVEL_JOIN} LEFT JOIN consents k ON k.discord_user_id = c.discord_user_id
       WHERE ${where} AND ${shownSql('c')}
       ORDER BY c.message_id DESC LIMIT ?`,
    )
    .bind(...args, limit)
    .all<ShownRow>();
  return results.map(toShowcaseMessage);
}

interface PostRow {
  id: string;
  channel_id: string;
  name: string | null;
  applied_tags: string;
  /** The forum's tags, JSON [{ id, name, moderated }]. */
  tags: string;
  replies: number;
  last_activity_at: string;
}

/**
 * The listed forum and media posts matching `where` (over `threads t`), latest activity first: those whose starter message
 * is shown, never a private conversation. Replies and activity count only shown messages.
 */
async function posts(relay: Relay, where: string, args: unknown[], limit: number): Promise<ShowcasePost[]> {
  const inPost = 'c.thread_id = CAST(t.id AS TEXT)';
  const { results } = await relay.db
    .prepare(
      `SELECT CAST(t.id AS TEXT) AS id, t.parent_id AS channel_id, t.name, t.applied_tags, ch.tags,
         (SELECT COUNT(*) FROM conversation c WHERE ${inPost} AND c.message_id != t.id AND ${shownSql('c')}) AS replies,
         (SELECT MAX(c.created_at) FROM conversation c WHERE ${inPost} AND ${shownSql('c')}) AS last_activity_at
       FROM threads t JOIN channels ch ON ch.id = t.parent_id
       WHERE ${where} AND t.private = 0 AND t.deleted_at IS NULL AND ch.type IN ('forum', 'media')
         AND EXISTS (SELECT 1 FROM conversation c WHERE c.message_id = t.id AND ${shownSql('c')})
       ORDER BY last_activity_at DESC, t.id DESC LIMIT ?`,
    )
    .bind(...args, limit)
    .all<PostRow>();
  if (!results.length) return [];
  const ids = results.map((r) => r.id);
  const starters = new Map((await shown(relay, `c.message_id IN (${placeholders(ids.length)})`, ids, ids.length)).map((m) => [m.message_id, m]));
  return results.map((r) => {
    const applied = new Set(JSON.parse(r.applied_tags) as string[]);
    // In the forum's order, as Discord shows them.
    const tags = (JSON.parse(r.tags) as { id: string; name: string }[]).filter((tag) => applied.has(tag.id)).map((tag) => tag.name);
    return {
      id: r.id,
      channel_id: r.channel_id,
      name: r.name ?? HIDDEN_NAME,
      tags,
      starter: starters.get(r.id)!,
      replies: r.replies,
      last_activity_at: r.last_activity_at,
    };
  });
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
async function homeChannels(relay: Relay): Promise<{ readable: ChannelRow[]; home: ChannelRow[] }> {
  const [channels, settings] = await Promise.all([agentChannels(relay, ANY_AGENT), getSettings(relay)]);
  const readable = channels.filter((c) => c.access.read).map((c) => c.row);
  // Checked on every read too: a channel closed to agents since it was picked drops off the page by itself.
  const home = settings.home_channel_ids.flatMap((id) => readable.filter((row) => row.id === id));
  return { readable, home };
}

/** The counts, and the home channels as rows. */
async function counted(relay: Relay): Promise<{ stats: Stats; home: ChannelRow[] }> {
  const now = relay.now();
  const midnight = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())).toISOString();
  const [agents, today, { readable, home }] = await Promise.all([
    relay.db.prepare("SELECT COUNT(*) AS n FROM agents WHERE kind = 'agent' AND status = 'active' AND deleted_at IS NULL").first<{ n: number }>(),
    relay.db.prepare("SELECT COUNT(*) AS n FROM conversation WHERE author_kind = 'agent' AND created_at >= ?").bind(midnight).first<{ n: number }>(),
    homeChannels(relay),
  ]);
  return {
    stats: {
      agents: agents?.n ?? 0,
      messages_today: today?.n ?? 0,
      channels: readable.length,
      home_channels: home.map((row) => ({ id: row.id, name: row.name })),
    },
    home,
  };
}

/** GET /v1/stats: the counts and the home channels, as the home page shows them. */
export async function stats(relay: Relay): Promise<Stats> {
  return (await counted(relay)).stats;
}

/** GET /internal/showcase: the counts, and each home channel's latest shown messages, oldest first, or a forum's posts. */
export async function showcase(relay: Relay): Promise<Showcase> {
  const { stats: counts, home } = await counted(relay);
  const home_channels = await Promise.all(
    home.map(async (row) => {
      const channel = { id: row.id, name: row.name };
      if (isForum(row)) return { ...channel, messages: [], posts: await posts(relay, 't.parent_id = ?', [row.id], SHOWCASE_POSTS) };
      const messages = await shown(relay, 'c.channel_id = ?', [row.id], SHOWCASE_MESSAGES);
      return { ...channel, messages: messages.reverse(), posts: null };
    }),
  );
  return { ...counts, home_channels };
}

/** GET /internal/showcase/posts/:id: a page of a listed post's shown messages, the latest first, oldest first within it. */
export async function showcasePost(relay: Relay, postId: string, before?: string): Promise<ShowcasePage> {
  const forums = (await homeChannels(relay)).home.filter(isForum).map((row) => row.id);
  const [post] = forums.length ? await posts(relay, `t.id = ? AND t.parent_id IN (${placeholders(forums.length)})`, [postId, ...forums], 1) : [];
  if (!post) throw notFound('That post isn’t on the home page.');
  const where = ['c.thread_id = ?'];
  const args: unknown[] = [postId];
  if (before) {
    // A string bound against an INTEGER column compares numerically (column affinity).
    where.push('c.message_id < ?');
    args.push(before);
  }
  const newest = await shown(relay, where.join(' AND '), args, POST_PAGE + 1);
  const page = newest.slice(0, POST_PAGE);
  return { messages: page.toReversed(), next_before: newest.length > POST_PAGE ? page.at(-1)!.message_id : null };
}

/**
 * Tells the live feed what just changed in the home channels (commitPlan calls it with the events it recorded): new and
 * edited messages as the page shows them, the IDs of removed ones, never a private conversation's, and the cards of the
 * forum posts they belong to.
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

  // The forum posts those messages are in, as their cards now read; a post that stopped being listed is removed.
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
    const cards = new Map((await posts(relay, `t.id IN (${placeholders(part.length)})`, part, part.length)).map((post) => [post.id, post]));
    for (const id of part) {
      const post = cards.get(id);
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
