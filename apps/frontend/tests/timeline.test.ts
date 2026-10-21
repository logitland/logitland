import { describe, expect, it } from 'vitest';
import { buildTimeline, changed, compareIds, mergeMessages } from '../src/lib/mirror/timeline.ts';
import type { MirrorMessage } from '../src/lib/mirror/types.ts';

const msg = (id: string, over: Partial<MirrorMessage> = {}): MirrorMessage => ({
  id,
  channelId: '1',
  threadId: null,
  at: '2026-10-19T10:00:00.000Z',
  editedAt: null,
  state: 'shown',
  voice: { kind: 'person', name: 'x' },
  text: 'hi',
  replyTo: null,
  poll: null,
  ...over,
});

describe('compareIds', () => {
  it('orders snowflakes as numbers, whatever their length', () => {
    expect(['1500000000000000002', '999999999999999999', '1500000000000000001'].sort(compareIds)).toEqual([
      '999999999999999999',
      '1500000000000000001',
      '1500000000000000002',
    ]);
  });
});

describe('buildTimeline', () => {
  it('puts replies under their thread, and a forum post is its own root', () => {
    const items = buildTimeline([msg('10'), msg('11', { threadId: '10' }), msg('12', { threadId: '12' }), msg('13', { threadId: '12' })]);
    expect(items.map((i) => [i.kind, i.kind === 'message' ? i.message.id : i.threadId, i.replies.map((r) => r.id)])).toEqual([
      ['message', '10', ['11']],
      ['message', '12', ['13']],
    ]);
  });

  it('holds replies whose first message is not loaded under a stub', () => {
    const items = buildTimeline([msg('20'), msg('21', { threadId: '5' }), msg('22', { threadId: '5' })]);
    expect(items.map((i) => i.kind)).toEqual(['message', 'orphan']);
    expect(items[1]!.replies.map((r) => r.id)).toEqual(['21', '22']);
  });

  it('lists every message flat when asked to', () => {
    const items = buildTimeline([msg('11', { threadId: '10' }), msg('12', { threadId: '10' })], { flat: true });
    expect(items.map((i) => (i.kind === 'message' ? i.message.id : '?'))).toEqual(['11', '12']);
    expect(items.every((i) => i.replies.length === 0)).toBe(true);
  });
});

describe('changed and mergeMessages', () => {
  it('sees an edit, a deletion, a new poll count and a new reply target', () => {
    const base = msg('1');
    expect(changed(base, msg('1'))).toBe(false);
    expect(changed(base, msg('1', { text: 'edited' }))).toBe(true);
    expect(changed(base, msg('1', { state: 'deleted', voice: null, text: null }))).toBe(true);
    expect(changed(base, msg('1', { replyTo: '0' }))).toBe(true);
    const poll = { question: 'q', answers: [], endsAt: null, multi: false, results: null };
    expect(changed(msg('1', { poll }), msg('1', { poll: { ...poll, results: { total: 3, final: false } } }))).toBe(true);
  });

  it('keeps what is there unless told to replace it', () => {
    const merged = mergeMessages([msg('1', { text: 'old' })], [msg('1', { text: 'new' }), msg('2')]);
    expect(merged.map((m) => [m.id, m.text])).toEqual([
      ['1', 'old'],
      ['2', 'hi'],
    ]);
    expect(mergeMessages([msg('1', { text: 'old' })], [msg('1', { text: 'new' })], true)[0]!.text).toBe('new');
  });
});
