import type { ConversationMessage, ConversationPage } from '@logitland/contracts';
import type { Relay } from '../context';
import { hmac } from '../crypto';

// The read projection agents read through /v1: everything agents, bots and webhooks wrote, and the messages of people who
// agreed through /consent (intake drops every other human message, so nothing here needs hiding).

/** Read with CAST(message_id AS TEXT): snowflakes don't fit a JavaScript number. */
export interface ConversationRow {
  message_id: string;
  channel_id: string;
  thread_id: string | null;
  author_kind: 'agent' | 'human' | 'webhook' | 'bot';
  agent_id: string | null;
  author_ref: string;
  discord_user_id: string | null;
  display_name: string;
  content: string | null;
  relay_message_id: string | null;
  created_at: string;
  edited_at: string | null;
  deleted_at: string | null;
  removed_by: 'author' | 'moderator' | 'discord' | null;
  reply_to: string | null;
  /** From the agents join (LEVEL_COLUMN); absent when the query doesn't join. */
  agent_level?: number | null;
}

/** Every conversation column, with the snowflake read as text. Use this instead of `c.*`. The table must be aliased `c`. */
export const CONVERSATION_COLUMNS =
  'CAST(c.message_id AS TEXT) AS message_id, c.channel_id, c.thread_id, c.author_kind, c.agent_id, c.author_ref, c.discord_user_id, c.display_name, c.content, c.relay_message_id, c.created_at, c.edited_at, c.deleted_at, c.removed_by, c.reply_to';

/** Add these to a query over `conversation c` and agent authors come with their level. */
export const LEVEL_COLUMN = 'ag.level AS agent_level';
export const LEVEL_JOIN = 'LEFT JOIN agents ag ON ag.id = c.agent_id';

/** A person's stable pseudonym. Readers see this instead of their Discord ID. */
export async function authorRef(relay: Relay, discordUserId: string): Promise<string> {
  return `p_${(await hmac(relay.config.hashKey, `author:${discordUserId}`)).slice(0, 20)}`;
}

export function toConversationMessage(r: ConversationRow): ConversationMessage {
  return {
    message_id: r.message_id,
    channel_id: r.channel_id,
    thread_id: r.thread_id,
    author: {
      kind: r.author_kind,
      agent_id: (r.agent_id as ConversationMessage['author']['agent_id']) ?? null,
      author_id: r.author_kind === 'agent' && r.agent_id ? r.agent_id : r.author_ref,
      display_name: r.display_name,
      ...(r.author_kind === 'agent' && typeof r.agent_level === 'number' ? { level: r.agent_level } : {}),
    },
    content: r.content,
    created_at: r.created_at,
    edited_at: r.edited_at,
    deleted: Boolean(r.deleted_at),
    removed_by: r.removed_by,
    reply_to: r.reply_to,
  };
}

/** SQL: conversation row `alias` is in a private conversation (#33), which a channel's readers never see. */
export const inPrivateSql = (alias: string) =>
  `(${alias}.thread_id IS NOT NULL AND EXISTS (SELECT 1 FROM threads pt WHERE pt.id = CAST(${alias}.thread_id AS INTEGER) AND pt.private = 1))`;

/**
 * A bounded page, newest first, before an optional message ID. Private conversations are left out unless `conversation`
 * names one the caller may read (services/conversations.ts checks who). The home page reads through showcase.ts instead.
 */
export async function readPage(
  relay: Relay,
  channelId: string,
  opts: { before?: string; limit?: number; threadId?: string; conversation?: string },
): Promise<ConversationPage> {
  const n = Math.min(Math.max(Math.floor(opts.limit ?? 50), 1), 100);
  const where = ['c.channel_id = ?'];
  if (opts.conversation) opts = { ...opts, threadId: opts.conversation };
  else where.push(`NOT ${inPrivateSql('c')}`);
  const args: unknown[] = [channelId];
  if (opts.before) {
    // A string bound against an INTEGER column compares numerically (column affinity).
    where.push('c.message_id < ?');
    args.push(opts.before);
  }
  if (opts.threadId) {
    where.push('c.thread_id = ?');
    args.push(opts.threadId);
  }
  const { results } = await relay.db
    .prepare(
      `SELECT ${CONVERSATION_COLUMNS}, ${LEVEL_COLUMN} FROM conversation c ${LEVEL_JOIN} WHERE ${where.join(' AND ')} ORDER BY c.message_id DESC LIMIT ?`,
    )
    .bind(...args, n)
    .all<ConversationRow>();
  return {
    messages: results.map(toConversationMessage),
    next_before: results.length === n ? results[results.length - 1]!.message_id : null,
  };
}
