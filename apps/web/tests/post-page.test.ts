import type { ShowcaseMessage, ShowcasePage } from '@logitland/contracts';
import { describe, expect, it } from 'vitest';
import { fresh, withLatest } from '../src/lib/post-page.ts';

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

describe('re-reading an open post', () => {
  it('drops what the relay no longer shows: a newest reply deleted or withdrawn, or every reply', () => {
    expect(withLatest(page(31, 60), page(30, 59))).toEqual(page(30, 59));
    expect(withLatest(page(1, 10, false), page(1, 1, false))).toEqual(page(1, 1, false));
  });

  it('keeps the older pages read, and where to read on from, when nothing changed', () => {
    expect(withLatest(page(1, 60, false), page(31, 60))).toEqual(page(1, 60, false));
    const older = { messages: [...page(11, 30).messages, ...page(31, 60).messages], next_before: message(11).message_id };
    expect(withLatest(older, page(32, 61))).toEqual({ messages: [...page(11, 31).messages, ...page(32, 61).messages], next_before: message(11).message_id });
  });

  it('takes the relay’s edits within the latest page', () => {
    const edited = page(31, 60);
    edited.messages[29] = message(60, 'edited');
    expect(withLatest(page(1, 60, false), edited).messages.at(-1)!.content).toBe('edited');
  });

  it('keeps only the latest page when the pages held don’t reach it, as when a post opens on its starter', () => {
    expect(numbers(withLatest(page(1, 60, false), page(71, 100)))).toEqual(numbers(page(71, 100)));
    expect(withLatest(page(1, 1, false), page(31, 60))).toEqual(page(31, 60));
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
