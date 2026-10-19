import type { ChannelType, MessageStatus, PolicyCode, PollInput, RelayMessage, Verdict } from '@logitland/contracts';
import type { Relay } from '../../context';
import { sha256 } from '../../crypto';

// relay_messages rows and the shapes made from them. A leaf module: everything else in posting imports it.

export interface MessageRow {
  id: string;
  agent_id: string;
  channel_id: string;
  thread_id: string | null;
  thread_name: string | null;
  tag_ids: string | null;
  auto_archive_minutes: number | null;
  reply_to: string | null;
  reply_prefix: string | null;
  poll: string | null;
  content: string | null;
  status: MessageStatus;
  verdict: Verdict | null;
  policy_code: PolicyCode | null;
  status_reason: string | null;
  held_kind: 'outage' | 'review' | null;
  review_attempts: number;
  next_review_at: string | null;
  reviewed_by: string | null;
  discord_message_id: string | null;
  idempotency_key: string;
  payload_digest: string;
  content_hash: string;
  created_at: string;
  sent_at: string | null;
  updated_at: string;
}

/** Why an unconfirmed send is `uncertain`. Dropped once Discord confirms it some other way (the Gateway showed the message). */
export const UNCERTAIN_REASON =
  'Discord didn’t confirm that it received the message (the request timed out, the connection dropped or Discord answered with an error), so it may or may not have been posted. Check the channel before sending it again, or ask the agent’s owner or an admin to resolve it.';

export const toRelayMessage = (r: MessageRow): RelayMessage => ({
  id: r.id,
  agent_id: r.agent_id,
  channel_id: r.channel_id,
  thread_id: r.thread_id,
  content: r.content,
  status: r.status,
  verdict: r.verdict,
  policy_code: r.policy_code,
  status_reason: r.status !== 'uncertain' && r.status_reason === UNCERTAIN_REASON ? null : r.status_reason,
  discord_message_id: r.discord_message_id,
  idempotency_key: r.idempotency_key,
  reply_to: r.reply_to,
  poll: parsePoll(r),
  created_at: r.created_at,
  updated_at: r.updated_at,
});

export const parsePoll = (r: Pick<MessageRow, 'poll'>): PollInput | null => (r.poll ? (JSON.parse(r.poll) as PollInput) : null);

/** What Discord shows for the message: the reply line, if there is one, above the text. A poll sent alone has no text. */
export const discordContent = (r: Pick<MessageRow, 'reply_prefix' | 'content'>): string =>
  r.reply_prefix ? (r.content ? `${r.reply_prefix}\n${r.content}` : r.reply_prefix) : (r.content ?? '');

/**
 * The thread to name when editing or deleting the message through its webhook: the one it was posted in. A thread started
 * from a message in a text or announcement channel hangs off the message, which stays in the channel.
 */
export function webhookThread(r: Pick<MessageRow, 'thread_id' | 'thread_name'>, channelType: ChannelType): string | undefined {
  if (!r.thread_id) return undefined;
  if (r.thread_name && channelType !== 'forum' && channelType !== 'media') return undefined;
  return r.thread_id;
}

export function getRow(relay: Relay, id: string): Promise<MessageRow | null> {
  return relay.db.prepare('SELECT * FROM relay_messages WHERE id = ?').bind(id).first<MessageRow>();
}

/** Lowercased, runs of whitespace collapsed to one space, ends trimmed. */
export const normalise = (text: string): string => text.toLowerCase().replace(/\s+/g, ' ').trim();

/**
 * sha256 of the normalised text as Discord shows it (reply line included). Duplicate detection uses it, and intake
 * matches what Discord shows back against it, so change both together.
 */
export function contentHash(text: string): Promise<string> {
  return sha256(normalise(text));
}
