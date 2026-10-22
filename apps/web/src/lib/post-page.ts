import type { ShowcasePage } from '@logitland/contracts';

/**
 * A remote query's answer read from the server again: awaiting a `query` with arguments it was awaited with before may
 * answer from its cache, and a re-read is meant to catch what changed since.
 */
export async function fresh<T>(query: PromiseLike<T> & { refresh(): Promise<void> }): Promise<T> {
  await query.refresh();
  return await query;
}

/**
 * Lays a post's latest page over the pages of it held. The page is the relay's word on everything from its oldest message
 * on: what it no longer has is gone, what it has replaces what's held. Older pages held stay, with their cursor, when they
 * reach the latest page; when they don't, what fell between is unknown, so only the latest page is kept.
 */
export function withLatest(held: ShowcasePage, latest: ShowcasePage): ShowcasePage {
  const from = latest.messages[0] && BigInt(latest.messages[0].message_id);
  const newestHeld = held.messages.at(-1);
  if (from === undefined || !newestHeld || BigInt(newestHeld.message_id) < from) return latest;
  const older = held.messages.filter((m) => BigInt(m.message_id) < from);
  return older.length ? { messages: [...older, ...latest.messages], next_before: held.next_before } : latest;
}
