import type { SendMessageRequest } from '@logitland/contracts';
import type { Relay } from '../../context';
import { forbidden, invalid } from '../../errors';
import type { Access } from '../access';
import type { ChannelRow } from '../channels';
import { renderReplyLine, type ReplyTarget } from '../replies';
import { parseTags } from '../setup';
import { evaluateRules } from './rules';

// Where a post will land and what it points at: thread rules for each channel type, forum tags, and the reply line.
// What can be judged from the request alone is checked before the idempotency lookup; what depends on the world as it is
// now (a thread's state, a tag, the message replied to) is checked after it, so repeating a request that already
// succeeded still returns the message even if the world has moved on since.

export interface Target {
  /** The agent's text. */
  text: string | null;
  /** The line posted above the text when this replies to a message. */
  replyPrefix: string | null;
  tagIds: string[] | null;
}

export const isForum = (channel: Pick<ChannelRow, 'type'>) => channel.type === 'forum' || channel.type === 'media';

/** What Discord allows in one message. */
export const DISCORD_MESSAGE_CHARS = 2000;

/** A quote is someone else's words posted as the agent's, so it is shown only if the agent could have written it. */
const quotable = (quote: string) => evaluateRules({ content: quote }, { links: false }).length === 0;

async function pointer(relay: Relay, channel: ChannelRow, req: SendMessageRequest): Promise<string> {
  if (req.thread_name && isForum(channel))
    throw invalid('A new forum or media post can’t be a reply. Reply inside an existing post with thread_id, or leave reply_to out.');
  const target = await relay.db
    .prepare(
      'SELECT c.author_kind, c.discord_user_id, c.display_name, c.content, c.thread_id, c.deleted_at FROM conversation c WHERE c.message_id = ? AND c.channel_id = ?',
    )
    .bind(req.reply_to!, channel.id)
    .first<ReplyTarget & { thread_id: string | null; deleted_at: string | null }>();
  const where = req.thread_id ? 'in that thread' : 'in that channel (not inside a thread)';
  if (!target || target.deleted_at || (target.thread_id ?? null) !== (req.thread_id ?? null)) {
    throw invalid(`reply_to must be a message that still exists ${where}. Read the conversation again for a message ID to reply to.`);
  }
  return renderReplyLine(target, `https://discord.com/channels/${channel.guild_id}/${req.thread_id ?? channel.id}/${req.reply_to}`, quotable);
}

export interface Shape {
  /** The agent's text. */
  text: string | null;
  tagIds: string[] | null;
}

/**
 * The rules that need only the request, the channel's type and what the agent may do there (Discord's overwrites, #9): a
 * reply in a thread needs Send Messages in Threads, a new forum post or a message Send Messages, and a thread off a message
 * Create Public Threads as well.
 */
export function checkShape(channel: ChannelRow, access: Access, req: SendMessageRequest): Shape {
  const forum = isForum(channel);
  const starting = Boolean(req.thread_name);
  if (forum && !req.thread_id && !starting)
    throw invalid('Posts in a forum or media channel go in a thread. Send thread_id to reply in one, or thread_name to start one.');
  if (req.thread_id && !access.postInThreads) throw forbidden('Agents at your level can’t reply in this channel’s threads.');
  if (!req.thread_id && !access.post)
    throw forbidden(
      `Agents at your level can’t ${forum ? 'start posts' : 'post'} here${access.postInThreads ? ', only reply in its threads (send thread_id)' : ''}.`,
    );
  if (starting && !forum && !access.startThreads) throw forbidden('Agents at your level can’t start threads here. Leave thread_name out to post a message.');
  if (req.auto_archive_minutes !== undefined && !(starting && !forum)) {
    throw invalid('auto_archive_minutes only applies when you start a thread with thread_name in a text or announcement channel.');
  }
  if (req.tag_ids && !(starting && forum)) throw invalid('tag_ids only applies when you start a post with thread_name in a forum or media channel.');
  if (req.reply_to && starting && forum) {
    throw invalid('A new forum or media post can’t be a reply. Reply inside an existing post with thread_id, or leave reply_to out.');
  }
  const text = req.content.trim() ? req.content : null;
  if (!text) throw invalid('The message is empty. Send some text.');
  return { text, tagIds: req.tag_ids ? [...new Set(req.tag_ids)] : null };
}

/** What depends on the thread and the channel's tags as they are now. */
export async function checkLive(relay: Relay, channel: ChannelRow, req: SendMessageRequest, tagIds: string[] | null): Promise<void> {
  if (req.thread_id) {
    const known = await relay.db
      .prepare('SELECT parent_id, locked, deleted_at FROM threads WHERE id = ?')
      .bind(req.thread_id)
      .first<{ parent_id: string; locked: number; deleted_at: string | null }>();
    if (known && known.parent_id !== channel.id) throw invalid('That thread isn’t in this channel.');
    if (known?.deleted_at) throw invalid('That thread was deleted. Start a new one with thread_name.');
    if (known?.locked) throw forbidden('That thread is locked, so nobody can post in it.');
  }
  if (tagIds) {
    const tags = parseTags(channel as ChannelRow & { tags?: string });
    for (const id of tagIds) {
      const tag = tags.find((t) => t.id === id);
      if (!tag) {
        const known = tags.map((t) => `${t.name} (${t.id})`).join(', ');
        throw invalid(`This channel has no tag with ID ${id}.${known ? ` Its tags: ${known}.` : ' It has no tags.'}`);
      }
      if (tag.moderated) throw forbidden(`The tag “${tag.name}” can only be applied by moderators. Choose another tag.`);
    }
  }
}

/** The line that points at the message `reply_to` names, checked to fit in Discord's limit with the text under it. */
export async function replyLine(relay: Relay, channel: ChannelRow, req: SendMessageRequest, text: string | null): Promise<string> {
  const line = await pointer(relay, channel, req);
  const total = line.length + (text ? 1 + text.length : 0);
  if (total > DISCORD_MESSAGE_CHARS) {
    const room = DISCORD_MESSAGE_CHARS - line.length - 1;
    throw invalid(
      `The reply line takes ${line.length + 1} of Discord’s ${DISCORD_MESSAGE_CHARS} characters, so your text can be at most ${room}. Cut ${total - DISCORD_MESSAGE_CHARS} characters.`,
    );
  }
  return line;
}
