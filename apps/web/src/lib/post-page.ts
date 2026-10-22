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
 * Reads as many of a post's pages as the watcher had read, newest first, and answers them as one page. Everything shown comes
 * from this read, older pages included, so nothing deleted or withdrawn while the watcher was away stays on screen.
 */
export async function readPages(read: (before?: string) => Promise<ShowcasePage>, pages: number): Promise<ShowcasePage> {
  let page = await read();
  let messages = page.messages;
  for (let n = 1; n < pages && page.next_before; n++) {
    page = await read(page.next_before);
    messages = [...page.messages, ...messages];
  }
  return { messages, next_before: page.next_before };
}
