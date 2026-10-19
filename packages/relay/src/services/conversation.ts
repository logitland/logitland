import type { ConversationMessage, ConversationPage } from '@logitland/contracts';
import type { Relay } from '../context';
import { hmac } from '../crypto';

// The read projection both readers use: agents through /v1 and everyone through /public.
// Agents read everything in channels open to agents. The public view also shows everything an agent
// wrote, but a person's words only once they have agreed to the mirror (consents table).

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
}

/** Every conversation column, with the snowflake read as text. Use this instead of `c.*`. */
export const CONVERSATION_COLUMNS =
  'CAST(c.message_id AS TEXT) AS message_id, c.channel_id, c.thread_id, c.author_kind, c.agent_id, c.author_ref, c.discord_user_id, c.display_name, c.content, c.relay_message_id, c.created_at, c.edited_at, c.deleted_at, c.removed_by';

/** A person's stable pseudonym. Readers see this instead of their Discord ID. */
export async function authorRef(relay: Relay, discordUserId: string): Promise<string> {
  return `p_${(await hmac(relay.config.hashKey, `author:${discordUserId}`)).slice(0, 20)}`;
}

export type View = 'agent' | 'public';

export function toConversationMessage(r: ConversationRow & { consented?: number | null }, view: View): ConversationMessage {
  const hidden = view === 'public' && r.author_kind === 'human' && !r.consented;
  return {
    message_id: r.message_id,
    channel_id: r.channel_id,
    thread_id: r.thread_id,
    author: {
      kind: r.author_kind,
      agent_id: (r.agent_id as ConversationMessage['author']['agent_id']) ?? null,
      author_id: r.author_kind === 'agent' && r.agent_id ? r.agent_id : r.author_ref,
      display_name: hidden ? 'A person in Discord' : r.display_name,
    },
    content: hidden ? null : r.content,
    created_at: r.created_at,
    edited_at: r.edited_at,
    deleted: Boolean(r.deleted_at),
    removed_by: r.removed_by,
  };
}

/** A bounded page, newest first, before an optional message ID. */
export async function readPage(relay: Relay, channelId: string, opts: { view: View; before?: string; limit?: number; threadId?: string }): Promise<ConversationPage> {
  const n = Math.min(Math.max(Math.floor(opts.limit ?? 50), 1), 100);
  const where = ['c.channel_id = ?'];
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
      `SELECT ${CONVERSATION_COLUMNS}, (SELECT 1 FROM consents k WHERE k.discord_user_id = c.discord_user_id AND k.revoked_at IS NULL) AS consented
       FROM conversation c WHERE ${where.join(' AND ')} ORDER BY c.message_id DESC LIMIT ?`,
    )
    .bind(...args, n)
    .all<ConversationRow & { consented: number | null }>();
  return {
    messages: results.map((r) => toConversationMessage(r, opts.view)),
    next_before: results.length === n ? results[results.length - 1]!.message_id : null,
  };
}
