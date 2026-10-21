import { snowflakeTime } from '../services/events';
import type { IntakeEventInput } from '../services/intake';

// Discord dispatch payloads in, intake events out. Messages in a thread belong to the thread's parent
// channel and carry `thread_id`. Only default (0) and reply (19) messages are kept: the rest are system
// messages (joins, pins, thread notices, poll results) with no author text. A poll's question and answers are not relayed:
// a message with a poll keeps only its text.

export const MESSAGE_TYPES: ReadonlySet<number> = new Set([0, 19]);
const REPLY = 19;
/** Announcement and public threads. Private threads (12) are only for the people invited to them, so they are never relayed. */
const THREAD_TYPES: ReadonlySet<number> = new Set([10, 11]);
/** The channel types the relay can use: text, announcement, forum, media. */
export const CHANNEL_TYPES: Readonly<Record<number, 'text' | 'announcement' | 'forum' | 'media'>> = { 0: 'text', 5: 'announcement', 15: 'forum', 16: 'media' };

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
  permission_overwrites?: { id: string; type: 0 | 1; allow: string; deny: string }[];
  /** Slowmode, in seconds. */
  rate_limit_per_user?: number;
  flags?: number;
}

export interface DiscordRoleLike {
  id: string;
  name: string;
  permissions: string;
  position?: number;
}

/** Discord's flag on a channel the bot can't view: from 2026-11-16 its name and overwrites are hidden (#9). */
export const CHANNEL_OBFUSCATED = 1 << 17;

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

/** A message as Discord's REST API or the Gateway describes it. Null for system messages. */
export function messageCreated(m: DiscordMessageLike, threads: ReadonlyMap<string, string>): IntakeEventInput | null {
  if (!m.author || m.timestamp === undefined || !MESSAGE_TYPES.has(m.type ?? 0)) return null;
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

/**
 * A channel the relay can use, with what decides who may use it. An obfuscated one carries only `hidden`: its name and
 * overwrites aren't real, so they aren't stored, and a CHANNEL_UPDATE with the real ones arrives when the bot gains access.
 */
function channelUpdate(c: DiscordChannelLike, guildId: string | undefined): IntakeEventInput[] {
  const type = CHANNEL_TYPES[c.type];
  const guild = c.guild_id ?? guildId;
  if (!type || !c.name || !guild) return [];
  if ((c.flags ?? 0) & CHANNEL_OBFUSCATED) return [{ kind: 'channel_hidden', channel_id: c.id, guild_id: guild, type }];
  return [
    {
      kind: 'channel_update',
      channel_id: c.id,
      guild_id: guild,
      parent_id: c.parent_id ?? null,
      name: c.name,
      type,
      overwrites: c.permission_overwrites ?? [],
      slowmode_seconds: c.rate_limit_per_user ?? 0,
      ...(c.available_tags ? { tags: c.available_tags.map((t) => ({ id: t.id, name: t.name, moderated: t.moderated ?? false })) } : {}),
    },
  ];
}

const roleUpdate = (r: DiscordRoleLike, guildId: string): IntakeEventInput => ({
  kind: 'role_update',
  role_id: r.id,
  guild_id: guildId,
  name: r.name,
  permissions: r.permissions,
  position: r.position ?? 0,
});

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
      // Discord also sends this when an embed unfurls, a message is pinned or a poll ends; only a real edit has a new edited_timestamp.
      const m = d as DiscordMessageLike;
      if (!inGuild(m.guild_id) || !m.edited_timestamp || (m.type !== undefined && !MESSAGE_TYPES.has(m.type))) return [];
      return [
        {
          kind: 'message_update',
          ...locate(m.channel_id, ctx.threads),
          message_id: m.id,
          ...(typeof m.content === 'string' ? { content: m.content } : {}),
          edited_timestamp: m.edited_timestamp,
        },
      ];
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
      const g = d as { id: string; unavailable?: boolean; roles?: DiscordRoleLike[]; channels?: DiscordChannelLike[]; threads?: DiscordChannelLike[] };
      // An outage sends only {id, unavailable: true}; a thread sync from that would archive every live thread.
      if (!inGuild(g.id) || g.unavailable) return [];
      const upserts = threadEvents(g.threads ?? [], ctx);
      return [
        ...(g.roles ?? []).map((r) => roleUpdate(r, g.id)),
        ...(g.channels ?? []).flatMap((c) => channelUpdate(c, g.id)),
        ...upserts,
        { kind: 'thread_sync', parent_ids: null, active_ids: (g.threads ?? []).map((c) => c.id) },
      ];
    }
    case 'CHANNEL_CREATE':
    case 'CHANNEL_UPDATE': {
      const c = d as DiscordChannelLike;
      return inGuild(c.guild_id) ? channelUpdate(c, c.guild_id) : [];
    }
    case 'CHANNEL_DELETE': {
      const c = d as DiscordChannelLike;
      return inGuild(c.guild_id) && CHANNEL_TYPES[c.type] ? [{ kind: 'channel_delete', channel_id: c.id }] : [];
    }
    case 'GUILD_ROLE_CREATE':
    case 'GUILD_ROLE_UPDATE': {
      const r = d as { guild_id: string; role: DiscordRoleLike };
      return inGuild(r.guild_id) ? [roleUpdate(r.role, r.guild_id)] : [];
    }
    case 'GUILD_ROLE_DELETE': {
      const r = d as { guild_id: string; role_id: string };
      return inGuild(r.guild_id) ? [{ kind: 'role_delete', role_id: r.role_id }] : [];
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
