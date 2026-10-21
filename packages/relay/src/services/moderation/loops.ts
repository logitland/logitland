import type { Relay } from '../../context';
import { CONVERSATION_COLUMNS, type ConversationRow } from '../conversation';
import { LOOP, PolicyError, explain } from './policy';

// The loop breaker: two agents answering each other, with nobody else speaking, can run forever.
// It looks at the last few messages in the place the new one would land (a thread, or the channel itself).

/** Newest first. Deleted messages stay: a tombstone still counts as someone having spoken. */
export async function recentConversation(relay: Relay, channelId: string, threadId: string | null, limit: number = LOOP.rows): Promise<ConversationRow[]> {
  const scope = threadId ? 'c.thread_id = ?' : 'c.thread_id IS NULL';
  const { results } = await relay.db
    .prepare(`SELECT ${CONVERSATION_COLUMNS} FROM conversation c WHERE c.channel_id = ? AND ${scope} ORDER BY c.message_id DESC LIMIT ?`)
    .bind(...(threadId ? [channelId, threadId, limit] : [channelId, limit]))
    .all<ConversationRow>();
  return results;
}

/**
 * True when every recent message is from an agent (no person, bot or webhook), the newest nine or more
 * strictly alternate between the same two agents inside ten minutes, and the sender is one of them.
 * A third voice, or any person, ends the loop.
 */
export function inLoop(rowsNewestFirst: ConversationRow[], senderId: string, now: Date): boolean {
  const rows = rowsNewestFirst;
  if (rows.length < LOOP.alternations + 1) return false;
  if (rows.some((r) => r.author_kind !== 'agent' || !r.agent_id)) return false;
  const a = rows[0]!.agent_id!;
  const b = rows[1]!.agent_id!;
  if (a === b) return false;
  let run = 2;
  while (run < rows.length && rows[run]!.agent_id === (run % 2 === 0 ? a : b)) run++;
  if (run - 1 < LOOP.alternations) return false;
  // The newest nine alone must fit the window, however much longer the alternation has run.
  if (now.getTime() - Date.parse(rows[LOOP.alternations]!.created_at) > LOOP.withinMs) return false;
  return senderId === a || senderId === b;
}

/**
 * Throws the 429 for a loop. Returns the rows it read so the classifier can use them as context. A new forum or media post
 * (`startsThread`) is not part of any loop and has no conversation to read, so nothing is read for it. A thread started in a
 * text channel is not that: its first message lands in the channel itself.
 */
export async function checkLoop(
  relay: Relay,
  input: { agentId: string; channelId: string; threadId: string | null; startsThread?: boolean; enabled?: boolean },
): Promise<ConversationRow[]> {
  if (input.startsThread) return [];
  const rows = await recentConversation(relay, input.channelId, input.threadId);
  // A level can switch the loop breaker off; the conversation is still the classifier's context.
  if (input.enabled !== false && inLoop(rows, input.agentId, relay.now()))
    throw new PolicyError(429, 'rate_limited', 'loop', explain('loop'), { retryAfterSeconds: LOOP.retryAfterSeconds });
  return rows;
}
