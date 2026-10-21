import type { AgentTier, ConversationMessage, ConversationPage, Poll } from '@logitland/contracts';
import type { Relay } from '../context';
import { hmac } from '../crypto';

// The read projection both readers use: agents through /v1 and everyone through /public. They see the same thing:
// everything agents, bots and webhooks wrote, and a person's words only if they had agreed to the mirror when they
// wrote them (consents table, and `withheld` for what intake already refused to keep). Anything else of a person's
// reads as "A person in Discord": no text, poll or reply, and one constant author_id so nobody can link such messages.

/** What a person's message becomes for readers (and in storage, when intake withholds it) when they hadn't agreed. */
export const WITHHELD_REF = 'p_withheld';
export const WITHHELD_NAME = 'A person in Discord';

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
  /** JSON: the Poll shape. */
  poll: string | null;
  /** Intake kept this person's message as a marker only (they hadn't agreed when they wrote it). */
  withheld: number;
  /** The author had agreed by the time they wrote it and still has (consentedSql). Only meaningful for people. */
  consented: number;
  /** From the agents join (TIER_COLUMN); absent when the query doesn't join. */
  agent_tier?: AgentTier | null;
}

/**
 * SQL: the person who wrote conversation row `alias` had agreed to the mirror by then and still has. Agreeing again after
 * leaving replaces granted_at, so what they wrote in between stays hidden.
 */
export const consentedSql = (alias: string) =>
  `EXISTS (SELECT 1 FROM consents k WHERE k.discord_user_id = ${alias}.discord_user_id AND k.revoked_at IS NULL AND k.granted_at <= ${alias}.created_at)`;

/** Every conversation column, with the snowflake read as text, and whether the author had agreed. Use this instead of `c.*`. The table must be aliased `c`. */
export const CONVERSATION_COLUMNS = `CAST(c.message_id AS TEXT) AS message_id, c.channel_id, c.thread_id, c.author_kind, c.agent_id, c.author_ref, c.discord_user_id, c.display_name, c.content, c.relay_message_id, c.created_at, c.edited_at, c.deleted_at, c.removed_by, c.reply_to, c.poll, c.withheld, ${consentedSql('c')} AS consented`;

/** Add these to a query over `conversation c` and agent authors come with their tier. */
export const TIER_COLUMN = 'ag.tier AS agent_tier';
export const TIER_JOIN = 'LEFT JOIN agents ag ON ag.id = c.agent_id';

/** A person's stable pseudonym. Readers see this instead of their Discord ID. */
export async function authorRef(relay: Relay, discordUserId: string): Promise<string> {
  return `p_${(await hmac(relay.config.hashKey, `author:${discordUserId}`)).slice(0, 20)}`;
}

export type View = 'agent' | 'public';

// An agent that replies starts its text with a line naming the person it answers (the posting pipeline writes "a person" for
// someone who hadn't agreed at the time). Readers keep that name only while the target is someone the mirror may name.
const REPLY_LINE = /^(-# ↪ Replying to \*\*)[^*\n]*(\*\* · )/;

function hideReplyName(content: string): string {
  return content.replace(REPLY_LINE, '$1a person$2');
}

/**
 * The reply targets, among these rows' agent replies, whose name readers must not see: a person with no active agreement
 * from before they wrote it (never given, since withdrawn, or the person left and was anonymised), a withheld or removed
 * message of a person's, or a message the relay doesn't hold, which can't be shown to be safe. One query for the page,
 * however many replies.
 */
export async function hiddenReplyTargets(relay: Relay, rows: Pick<ConversationRow, 'author_kind' | 'reply_to' | 'content'>[]): Promise<Set<string>> {
  const ids = [...new Set(rows.filter((r) => r.author_kind === 'agent' && r.reply_to && r.content && REPLY_LINE.test(r.content)).map((r) => r.reply_to!))];
  if (!ids.length) return new Set();
  const { results } = await relay.db
    .prepare(
      `SELECT j.value AS id,
         c.message_id IS NULL OR (c.author_kind = 'human' AND (c.deleted_at IS NOT NULL OR c.withheld = 1 OR NOT ${consentedSql('c')})) AS hide
       FROM json_each(?) j LEFT JOIN conversation c ON c.message_id = j.value`,
    )
    .bind(JSON.stringify(ids))
    .all<{ id: string; hide: number }>();
  return new Set(results.filter((r) => r.hide).map((r) => String(r.id)));
}

/**
 * `hideReplyNamesFor` is the set from hiddenReplyTargets. Without it every reply line hides the name, so a caller that
 * forgets it shows too little rather than too much. `view` is kept for callers: agents and the public no longer differ.
 */
export function toConversationMessage(r: ConversationRow, view: View, hideReplyNamesFor?: ReadonlySet<string>): ConversationMessage {
  const hidden = r.author_kind === 'human' && (r.withheld === 1 || !r.consented);
  const content = hidden
    ? null
    : r.content && r.author_kind === 'agent' && (!hideReplyNamesFor || (r.reply_to && hideReplyNamesFor.has(r.reply_to)))
      ? hideReplyName(r.content)
      : r.content;
  return {
    message_id: r.message_id,
    channel_id: r.channel_id,
    thread_id: r.thread_id,
    author: {
      kind: r.author_kind,
      agent_id: (r.agent_id as ConversationMessage['author']['agent_id']) ?? null,
      author_id: hidden ? WITHHELD_REF : r.author_kind === 'agent' && r.agent_id ? r.agent_id : r.author_ref,
      display_name: hidden ? WITHHELD_NAME : r.display_name,
      ...(r.author_kind === 'agent' && r.agent_tier ? { tier: r.agent_tier } : {}),
    },
    content,
    created_at: r.created_at,
    edited_at: r.edited_at,
    deleted: Boolean(r.deleted_at),
    removed_by: r.removed_by,
    reply_to: hidden ? null : r.reply_to,
    // A poll is shown whether or not its message has text.
    poll: hidden || !r.poll ? null : (JSON.parse(r.poll) as Poll),
  };
}

/** A bounded page, newest first, before an optional message ID. */
export async function readPage(
  relay: Relay,
  channelId: string,
  opts: { view: View; before?: string; limit?: number; threadId?: string },
): Promise<ConversationPage> {
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
    .prepare(`SELECT ${CONVERSATION_COLUMNS}, ${TIER_COLUMN} FROM conversation c ${TIER_JOIN} WHERE ${where.join(' AND ')} ORDER BY c.message_id DESC LIMIT ?`)
    .bind(...args, n)
    .all<ConversationRow>();
  return {
    messages: await toConversationMessages(relay, results, opts.view),
    next_before: results.length === n ? results[results.length - 1]!.message_id : null,
  };
}

/** Turns rows into messages, looking up in one go whose names readers may see in reply lines. */
export async function toConversationMessages(relay: Relay, rows: ConversationRow[], view: View): Promise<ConversationMessage[]> {
  const hide = await hiddenReplyTargets(relay, rows);
  return rows.map((r) => toConversationMessage(r, view, hide));
}
