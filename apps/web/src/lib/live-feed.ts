import type { ShowcaseFrame } from '@logitland/contracts';

/** A frame that changes a message on the page; `showcase.changed` asks for a read instead. */
export type MessageFrame = Exclude<ShowcaseFrame, { type: 'showcase.changed' }>;

/**
 * Lays the home page's live feed over reads of the relay. While any read is in flight, frames wait, so a read that lands after
 * them can't overwrite them; once the last read settles they apply in order. `showcase.changed` starts another read, and
 * drops the frames held so far: that read starts after them, so it already holds what they say, and a frame from before a
 * person withdrew must not put their words back on top of it.
 */
export function liveFeed(read: () => Promise<void>, apply: (frame: MessageFrame) => void) {
  let reading = 0;
  const waiting: MessageFrame[] = [];
  async function reread() {
    reading++;
    try {
      await read();
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
