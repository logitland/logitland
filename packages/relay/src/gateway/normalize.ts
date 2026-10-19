import type { Poll } from '@logitland/contracts';
import { snowflakeTime } from '../services/events';
import type { IntakeEventInput } from '../services/intake';

// Discord dispatch payloads in, intake events out. Messages in a thread belong to the thread's parent
// channel and carry `thread_id`. Only default (0) and reply (19) messages are kept: the rest are system
// messages (joins, pins, thread notices, poll results) with no author text.

export const MESSAGE_TYPES: ReadonlySet<number> = new Set([0, 19]);
const REPLY = 19;
/** Announcement and public threads. Private threads (12) are only for the people invited to them, so they are never relayed. */
const THREAD_TYPES: ReadonlySet<number> = new Set([10, 11]);
/** The channel types the relay can use: text, announcement, forum, media. */
export const CHANNEL_TYPES: Readonly<Record<number, 'text' | 'announcement' | 'forum' | 'media'>> = { 0: 'text', 5: 'announcement', 15: 'forum', 16: 'media' };

export interface DiscordPollLike {
  question?: { text?: string | null };
  answers?: { answer_id?: number; poll_media?: { text?: string | null; emoji?: { name?: string | null } | null } }[];
  expiry?: string | null;
  allow_multiselect?: boolean;
  results?: { is_finalized?: boolean; answer_counts?: { id: number; count: number }[] } | null;
}

export interface DiscordMessageLike {
  id: string;
  channel_id: string;
  guild_id?: string;
  author?: { id: string; username: string; global_name?: string | null; bot?: boolean };
  webhook_id?: string;
  content?: string;
  timestamp?: string;
  edited_timestamp?: string | null;
  type?: number;
  message_reference?: { message_id?: string; type?: number } | null;
  poll?: DiscordPollLike | null;
}

export interface DiscordChannelLike {
  id: string;
  guild_id?: string;
  parent_id?: string | null;
  /** On threads: the user who created it. */
  owner_id?: string;
  name?: string;
  type: number;
  thread_metadata?: { archived?: boolean; locked?: boolean; create_timestamp?: string | null } | null;
  available_tags?: { id: string; name: string; moderated?: boolean }[];
  /** On forum and media posts: the tags applied to them. */
  applied_tags?: string[];
}

export interface NormalizeContext {
  /** Only this guild's events are kept. Null keeps every guild's. */
  guildId: string | null;
  /** Thread ID to parent channel ID. Thread events update it as they are normalised. */
  threads: Map<string, string>;
}

export function locate(channelId: string, threads: ReadonlyMap<string, string>): { channel_id: string; thread_id: string | null } {
  const parent = threads.get(channelId);
  return parent ? { channel_id: parent, thread_id: channelId } : { channel_id: channelId, thread_id: null };
}

/** A poll as Discord describes it (on a message, or in a webhook's answer) in the shape the relay stores. Null for no poll. */
export function pollFromDiscord(p: DiscordPollLike | null | undefined): Poll | null {
  if (!p?.answers?.length) return null;
  const results = pollResults(p);
  return {
    question: p.question?.text ?? '',
    answers: p.answers.map((a, i) => ({
      id: a.answer_id ?? i + 1,
      text: a.poll_media?.text ?? a.poll_media?.emoji?.name ?? '',
      emoji: a.poll_media?.emoji?.name ?? null,
    })),
    expires_at: p.expiry ? new Date(p.expiry).toISOString() : null,
    allow_multiselect: p.allow_multiselect ?? false,
    ...(results ? { results } : {}),
  };
}

/** The tallies Discord reports once a poll has results; null before. */
export function pollResults(p: DiscordPollLike | null | undefined): NonNullable<Poll['results']> | null {
  const r = p?.results;
  return r ? { finalized: r.is_finalized ?? false, counts: (r.answer_counts ?? []).map((c) => ({ id: c.id, count: c.count })) } : null;
}

/** A message as Discord's REST API or the Gateway describes it. Null for system messages. */
export function messageCreated(m: DiscordMessageLike, threads: ReadonlyMap<string, string>): IntakeEventInput | null {
  if (!m.author || m.timestamp === undefined || !MESSAGE_TYPES.has(m.type ?? 0)) return null;
  const poll = pollFromDiscord(m.poll);
  return {
    kind: 'message_create',
    ...locate(m.channel_id, threads),
    message_id: m.id,
    author: {
      id: m.author.id,
      username: m.author.username,
      global_name: m.author.global_name ?? null,
      bot: m.author.bot ?? false,
      webhook_id: m.webhook_id ?? null,
    },
    content: m.content ?? '',
    timestamp: m.timestamp,
    edited_timestamp: m.edited_timestamp ?? null,
    // Only a reply (type 19) answers a message; forwards and pins also carry a reference.
    reply_to: m.type === REPLY ? (m.message_reference?.message_id ?? null) : null,
    poll,
  };
}

/** Thread events for channel objects that are threads of this guild. Remembers each thread's parent in the context. */
export function threadEvents(channels: DiscordChannelLike[], ctx: NormalizeContext): IntakeEventInput[] {
  const out: IntakeEventInput[] = [];
  for (const c of channels) {
    if (!THREAD_TYPES.has(c.type) || !c.parent_id || (c.guild_id && ctx.guildId && c.guild_id !== ctx.guildId)) continue;
    ctx.threads.set(c.id, c.parent_id);
    out.push({
      kind: 'thread_upsert',
      thread_id: c.id,
      parent_id: c.parent_id,
      name: c.name ?? null,
      owner_id: c.owner_id ?? null,
      created_at: c.thread_metadata?.create_timestamp ?? snowflakeTime(c.id),
      archived: c.thread_metadata?.archived ?? null,
      locked: c.thread_metadata?.locked ?? null,
      applied_tags: c.applied_tags ?? null,
    });
  }
  return out;
}

function channelUpdate(c: DiscordChannelLike): IntakeEventInput[] {
  const type = CHANNEL_TYPES[c.type];
  if (!type || !c.name) return [];
  return [
    {
      kind: 'channel_update',
      channel_id: c.id,
      name: c.name,
      type,
      ...(c.available_tags ? { tags: c.available_tags.map((t) => ({ id: t.id, name: t.name, moderated: t.moderated ?? false })) } : {}),
    },
  ];
}

/** The intake events a dispatch produces, in order. Dispatches the relay doesn't use produce none. */
export function normalizeDispatch(t: string, d: unknown, ctx: NormalizeContext): IntakeEventInput[] {
  const inGuild = (guildId: string | undefined, missingOk = false) => ctx.guildId === null || (guildId === undefined ? missingOk : guildId === ctx.guildId);
  switch (t) {
    case 'MESSAGE_CREATE': {
      const m = d as DiscordMessageLike;
      const e = inGuild(m.guild_id) ? messageCreated(m, ctx.threads) : null;
      return e ? [e] : [];
    }
    case 'MESSAGE_UPDATE': {
      // Discord also sends this when an embed unfurls or a message is pinned; only a real edit has a new edited_timestamp.
      // A poll that has ended reports its results the same way, without an edit.
      const m = d as DiscordMessageLike;
      if (!inGuild(m.guild_id)) return [];
      const out: IntakeEventInput[] = [];
      if (m.edited_timestamp && (m.type === undefined || MESSAGE_TYPES.has(m.type))) {
        out.push({
          kind: 'message_update',
          ...locate(m.channel_id, ctx.threads),
          message_id: m.id,
          ...(typeof m.content === 'string' ? { content: m.content } : {}),
          edited_timestamp: m.edited_timestamp,
        });
      }
      const results = pollResults(m.poll);
      if (results) out.push({ kind: 'message_poll', ...locate(m.channel_id, ctx.threads), message_id: m.id, results });
      return out;
    }
    case 'MESSAGE_DELETE': {
      const m = d as { id: string; channel_id: string; guild_id?: string };
      return inGuild(m.guild_id, true) ? [{ kind: 'message_delete', ...locate(m.channel_id, ctx.threads), message_id: m.id }] : [];
    }
    case 'MESSAGE_DELETE_BULK': {
      const m = d as { ids: string[]; channel_id: string; guild_id?: string };
      return inGuild(m.guild_id, true) && m.ids.length ? [{ kind: 'message_delete_bulk', ...locate(m.channel_id, ctx.threads), message_ids: m.ids }] : [];
    }
    case 'THREAD_CREATE':
    case 'THREAD_UPDATE':
      return threadEvents([d as DiscordChannelLike], ctx);
    case 'THREAD_DELETE': {
      const c = d as DiscordChannelLike;
      return inGuild(c.guild_id, true) && c.parent_id ? [{ kind: 'thread_delete', thread_id: c.id, parent_id: c.parent_id }] : [];
    }
    case 'THREAD_LIST_SYNC': {
      // The list is every active thread in the named channels (or the whole guild); any other thread there has been archived.
      const g = d as { guild_id?: string; channel_ids?: string[]; threads?: DiscordChannelLike[] };
      if (!inGuild(g.guild_id)) return [];
      const upserts = threadEvents(g.threads ?? [], ctx);
      return [...upserts, { kind: 'thread_sync', parent_ids: g.channel_ids ?? null, active_ids: (g.threads ?? []).map((c) => c.id) }];
    }
    case 'GUILD_CREATE': {
      const g = d as { id: string; unavailable?: boolean; channels?: DiscordChannelLike[]; threads?: DiscordChannelLike[] };
      // An outage sends only {id, unavailable: true}; a thread sync from that would archive every live thread.
      if (!inGuild(g.id) || g.unavailable) return [];
      const upserts = threadEvents(g.threads ?? [], ctx);
      return [
        ...(g.channels ?? []).flatMap(channelUpdate),
        ...upserts,
        { kind: 'thread_sync', parent_ids: null, active_ids: (g.threads ?? []).map((c) => c.id) },
      ];
    }
    case 'CHANNEL_UPDATE': {
      const c = d as DiscordChannelLike;
      return inGuild(c.guild_id) ? channelUpdate(c) : [];
    }
    default:
      return [];
  }
}

/** Channels that exist and are not threads, learned from GUILD_CREATE and CHANNEL_* dispatches. */
export function channelChanges(t: string, d: unknown): { add: string[]; remove: string[] } {
  switch (t) {
    case 'GUILD_CREATE':
      return { add: ((d as { channels?: DiscordChannelLike[] }).channels ?? []).map((c) => c.id), remove: [] };
    case 'CHANNEL_CREATE':
    case 'CHANNEL_UPDATE':
      return { add: [(d as DiscordChannelLike).id], remove: [] };
    case 'CHANNEL_DELETE':
      return { add: [], remove: [(d as DiscordChannelLike).id] };
    default:
      return { add: [], remove: [] };
  }
}

/** The channel ID a message dispatch is about, for resolving unknown threads before normalising. */
export function messageChannelId(t: string, d: unknown): string | null {
  return t === 'MESSAGE_CREATE' || t === 'MESSAGE_UPDATE' || t === 'MESSAGE_DELETE' || t === 'MESSAGE_DELETE_BULK'
    ? (d as { channel_id: string }).channel_id
    : null;
}
