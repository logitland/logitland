import type { ConversationMessage, Thread, ThreadPage } from '@logitland/contracts';
import type { Relay } from '../context';
import { readMessages } from './conversation';
import { placeholders } from './events';

// Threads in a relayed channel. Forum and media posts are threads whose starter message ID is the thread ID, and so is a
// thread started from a message; a thread made without one has no starter. A thread's title is the words of whoever named
// it, so intake keeps it only when an agent (through the relay's webhook or bot) or another bot or webhook named the thread.
// A thread a person named, or one whose starter was removed, has no stored name and reads as HIDDEN_NAME.

export const HIDDEN_NAME = 'Untitled thread';

interface ThreadRow {
  id: string;
  parent_id: string;
  name: string | null;
  created_at: string;
  archived: number;
  locked: number;
  message_count: number;
  last_message_at: string | null;
  creator_agent_id: string | null;
  applied_tags: string;
  starter_message_id: string | null;
}

/** A page of a channel's threads, newest first, without deleted ones. Archived threads are left out unless asked for. */
export async function listThreads(
  relay: Relay,
  channelId: string,
  opts: { includeArchived?: boolean; before?: string; limit?: number; avatars?: boolean },
): Promise<ThreadPage> {
  const n = Math.min(Math.max(Math.floor(opts.limit ?? 50), 1), 100);
  const where = ['t.parent_id = ?'];
  const args: unknown[] = [channelId];
  if (!opts.includeArchived) where.push('t.archived = 0');
  if (opts.before) {
    // A string bound against an INTEGER column compares numerically (column affinity).
    where.push('t.id < ?');
    args.push(opts.before);
  }
  const threads = await selectThreads(relay, where, args, n, opts.avatars);
  return { threads, next_before: threads.length === n ? threads.at(-1)!.id : null };
}

/** The listed threads with these IDs (at most MAX_PARAMS; archived or not), as the threads read shows them. */
export const readThreads = (relay: Relay, ids: string[], opts: { avatars?: boolean } = {}) =>
  selectThreads(relay, [`t.id IN (${placeholders(ids.length)})`], ids, ids.length, opts.avatars);

/** The threads matching `where` over `threads t`, newest first, each with its starter as readers see it. */
async function selectThreads(relay: Relay, where: string[], args: unknown[], limit: number, avatars?: boolean): Promise<Thread[]> {
  // Private conversations (#33) are listed only to their members, through GET /v1/conversations.
  const { results } = await relay.db
    .prepare(
      `SELECT CAST(t.id AS TEXT) AS id, t.parent_id, t.name, t.created_at, t.archived, t.locked, t.message_count, t.last_message_at, t.creator_agent_id, t.applied_tags,
         CASE WHEN ch.type IN ('forum', 'media') THEN CAST(t.id AS TEXT) ELSE (SELECT CAST(s.message_id AS TEXT) FROM conversation s WHERE s.message_id = t.id) END AS starter_message_id
       FROM threads t JOIN channels ch ON ch.id = t.parent_id
       WHERE ${where.join(' AND ')} AND t.deleted_at IS NULL AND t.private = 0 ORDER BY t.id DESC LIMIT ?`,
    )
    .bind(...args, limit)
    .all<ThreadRow>();
  const ids = results.map((r) => r.id);
  const starters = new Map((await readMessages(relay, ids, { avatars })).map((m) => [m.message_id, m]));
  return results.map((r) => toThread(r, starters.get(r.id) ?? null));
}

function toThread(r: ThreadRow, starter: ConversationMessage | null): Thread {
  const hidden = r.name === null;
  return {
    id: r.id,
    channel_id: r.parent_id,
    name: r.name ?? HIDDEN_NAME,
    name_hidden: hidden,
    applied_tags: JSON.parse(r.applied_tags) as string[],
    created_at: r.created_at,
    last_message_at: r.last_message_at,
    message_count: r.message_count,
    archived: r.archived === 1,
    locked: r.locked === 1,
    starter_message_id: r.starter_message_id,
    starter,
    creator_agent_id: r.creator_agent_id as Thread['creator_agent_id'],
  };
}
