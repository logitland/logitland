import type { IntakeEventInput } from '../services/intake';

// Discord dispatch payloads in, intake events out. Messages in a thread belong to the thread's parent
// channel and carry `thread_id`. Only default (0) and reply (19) messages are kept: the rest are system
// messages (joins, pins, thread notices) with no author text.

export const MESSAGE_TYPES: ReadonlySet<number> = new Set([0, 19]);
/** Announcement, public and private threads. */
const THREAD_TYPES: ReadonlySet<number> = new Set([10, 11, 12]);

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
}

export interface DiscordChannelLike {
  id: string;
  guild_id?: string;
  parent_id?: string | null;
  name?: string;
  type: number;
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

/** A message as Discord's REST API or the Gateway describes it. Null for system messages. */
export function messageCreated(m: DiscordMessageLike, threads: ReadonlyMap<string, string>): IntakeEventInput | null {
  if (!m.author || m.timestamp === undefined || !MESSAGE_TYPES.has(m.type ?? 0)) return null;
  return {
    kind: 'message_create',
    ...locate(m.channel_id, threads),
    message_id: m.id,
    author: { id: m.author.id, username: m.author.username, global_name: m.author.global_name ?? null, bot: m.author.bot ?? false, webhook_id: m.webhook_id ?? null },
    content: m.content ?? '',
    timestamp: m.timestamp,
    edited_timestamp: m.edited_timestamp ?? null,
  };
}

function threadUpserts(channels: DiscordChannelLike[], ctx: NormalizeContext): IntakeEventInput[] {
  const out: IntakeEventInput[] = [];
  for (const c of channels) {
    if (!THREAD_TYPES.has(c.type) || !c.parent_id || (c.guild_id && ctx.guildId && c.guild_id !== ctx.guildId)) continue;
    ctx.threads.set(c.id, c.parent_id);
    out.push({ kind: 'thread_upsert', thread_id: c.id, parent_id: c.parent_id, name: c.name ?? null });
  }
  return out;
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
      const m = d as DiscordMessageLike;
      if (!inGuild(m.guild_id) || !m.edited_timestamp || (m.type !== undefined && !MESSAGE_TYPES.has(m.type))) return [];
      return [{ kind: 'message_update', ...locate(m.channel_id, ctx.threads), message_id: m.id, ...(typeof m.content === 'string' ? { content: m.content } : {}), edited_timestamp: m.edited_timestamp }];
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
      return threadUpserts([d as DiscordChannelLike], ctx);
    case 'THREAD_LIST_SYNC':
      return threadUpserts((d as { threads?: DiscordChannelLike[] }).threads ?? [], ctx);
    case 'GUILD_CREATE': {
      const g = d as { id: string; threads?: DiscordChannelLike[] };
      return inGuild(g.id) ? threadUpserts(g.threads ?? [], ctx) : [];
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
  return t === 'MESSAGE_CREATE' || t === 'MESSAGE_UPDATE' || t === 'MESSAGE_DELETE' || t === 'MESSAGE_DELETE_BULK' ? (d as { channel_id: string }).channel_id : null;
}
