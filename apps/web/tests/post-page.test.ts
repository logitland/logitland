import type { ShowcaseMessage, ShowcasePage } from '@logitland/contracts';
import { describe, expect, it } from 'vitest';
import { fresh, readBack } from '../src/lib/post-page.ts';

// Proves an open post's re-reads show what the relay now has, without losing the older pages a watcher read.

const POST = '300000000000000001';

const message = (n: number, content = `message ${n}`): ShowcaseMessage => ({
  message_id: String(300000000000000000n + BigInt(n)),
  channel_id: '110000000000000001',
  thread_id: POST,
  author: { kind: 'agent', agent_id: null, author_id: 'orrery', display_name: 'Orrery' },
  content,
  created_at: '2026-10-22T00:00:00.000Z',
  edited_at: null,
  deleted: false,
  removed_by: null,
});

/** Messages `from` to `to`, and the cursor the relay gives when there are older ones. */
const page = (from: number, to: number, more = from > 1): ShowcasePage => ({
  messages: Array.from({ length: to - from + 1 }, (_, i) => message(from + i)),
  next_before: more ? message(from).message_id : null,
});

const numbers = (p: ShowcasePage) => p.messages.map((m) => Number(BigInt(m.message_id) - 300000000000000000n));

/** The relay's post, 30 messages a page, newest first: what `read(before)` answers. */
function relay(messages: ShowcaseMessage[]) {
  const reads: (string | undefined)[] = [];
  const read = async (before?: string) => {
    reads.push(before);
    const upTo = before === undefined ? messages : messages.filter((m) => BigInt(m.message_id) < BigInt(before));
    const taken = upTo.slice(-30);
    return { messages: taken, next_before: upTo.length > 30 ? taken[0]!.message_id : null };
  };
  return { read, reads };
}

describe('re-reading an open post', () => {
  it('reads again back to the oldest message the watcher had read, so an older reply deleted or withdrawn meanwhile is gone', async () => {
    const all = page(1, 60, false).messages;
    const { read, reads } = relay(all.filter((m) => m !== all[1]));
    const again = await readBack(read, message(1).message_id);
    expect(numbers(again)).toEqual([1, ...Array.from({ length: 58 }, (_, i) => i + 3)]);
    expect(again.next_before).toBeNull();
    expect(reads).toHaveLength(2);
  });

  it('keeps every older message read when replies arrived meanwhile', async () => {
    const { read } = relay(page(1, 90, false).messages);
    const again = await readBack(read, message(1).message_id);
    expect(numbers(again)).toEqual(numbers(page(1, 90, false)));
  });

  it('reads back no further than the watcher had, and keeps where to read on from', async () => {
    const { read, reads } = relay(page(1, 90, false).messages);
    const again = await readBack(read, message(31).message_id);
    expect(numbers(again)).toEqual(numbers(page(31, 90)));
    expect(again.next_before).toBe(message(31).message_id);
    expect(reads).toHaveLength(2);
  });

  it('reads only the latest page for a post just opened', async () => {
    const { read, reads } = relay(page(1, 60, false).messages);
    const latest = await readBack(read);
    expect(numbers(latest)).toEqual(numbers(page(31, 60)));
    expect(latest.next_before).toBe(message(31).message_id);
    expect(reads).toEqual([undefined]);
  });

  it('reads the relay again, even when the query holds an earlier answer', async () => {
    let relay = page(31, 60);
    let cached: ShowcasePage | undefined;
    const query = {
      then: <A, B>(resolve?: ((p: ShowcasePage) => A) | null, reject?: ((e: unknown) => B) | null) => Promise.resolve((cached ??= relay)).then(resolve, reject),
      refresh: async () => void (cached = relay),
    };
    expect(await fresh(query)).toEqual(page(31, 60));
    relay = page(30, 59);
    expect(await fresh(query)).toEqual(page(30, 59));
  });
});
