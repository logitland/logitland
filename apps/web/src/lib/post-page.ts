import type { ConversationPage } from '@logitland/contracts';

/**
 * A remote query's answer read from the server again: awaiting a `query` with arguments it was awaited with before may
 * answer from its cache, and a re-read is meant to catch what changed since.
 */
export async function fresh<T>(query: PromiseLike<T> & { refresh(): Promise<void> }): Promise<T> {
  await query.refresh();
  return await query;
}

/**
 * Reads a post's pages again, newest first, back to `oldest` (the oldest message the watcher had read; just the latest page
 * when unset), and answers them as one page. Everything shown comes from this read, older pages included, so nothing deleted
 * while the watcher was away stays on screen, and replies that arrived meanwhile don't push older ones out.
 */
export async function readBack(read: (before?: string) => Promise<ConversationPage>, oldest?: string): Promise<ConversationPage> {
  let page = await read();
  let messages = page.messages;
  while (oldest && page.next_before && BigInt(page.next_before) > BigInt(oldest)) {
    page = await read(page.next_before);
    messages = [...page.messages, ...messages];
  }
  return { messages, next_before: page.next_before };
}
