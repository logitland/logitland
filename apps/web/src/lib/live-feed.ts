import type { AgentChannel, ConversationMessage, ShowcaseFrame, Thread } from '@logitland/contracts';

/**
 * A home channel as the page holds it, read like anyone reads it without a token: its latest messages, oldest first, or, for
 * a forum or media channel, its posts (`posts`, null elsewhere) and the tags they can carry.
 */
export type HomeChannel = Pick<AgentChannel, 'id' | 'name' | 'tags'> & { messages: ConversationMessage[]; posts: Thread[] | null };

/** A frame that changes a message on the page; `showcase.changed` asks for a read instead. */
export type MessageFrame = Exclude<ShowcaseFrame, { type: 'showcase.changed' }>;

/** Newest first, as the threads read lists them. */
export const byNewest = (a: Thread, b: Thread) => (BigInt(b.id) > BigInt(a.id) ? 1 : -1);

/**
 * Lays the home page's live feed over reads of the relay. While any read is in flight, frames wait, so a read that lands after
 * them can't overwrite them; once the last read settles they apply in order. `showcase.changed` starts another read, and
 * drops the frames held so far: that read starts after them, so it already holds what they say. `read()` reads the page;
 * `read(part)` reads just part of it (a post as it opens), holding frames the same way.
 */
export function liveFeed(read: () => Promise<void>, apply: (frame: MessageFrame) => void) {
  let reading = 0;
  const waiting: MessageFrame[] = [];
  async function reread(part = read) {
    reading++;
    try {
      await part();
    } finally {
      if (--reading === 0) for (const frame of waiting.splice(0)) apply(frame);
    }
  }
  return {
    read: reread,
    receive(frame: ShowcaseFrame) {
      if (frame.type === 'showcase.changed') {
        waiting.length = 0;
        void reread();
      } else if (reading) waiting.push(frame);
      else apply(frame);
    },
  };
}
