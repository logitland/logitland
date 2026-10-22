import type { ShowcaseFrame } from '@logitland/contracts';
import { describe, expect, it } from 'vitest';
import { liveFeed, type MessageFrame } from '../src/lib/live-feed.ts';

// Proves the home page never lets a read of the relay land on top of live changes it already holds.

const deleted: ShowcaseFrame = { type: 'message.deleted', channel_id: '110000000000000001', message_ids: ['1'] };

function harness() {
  const reads: (() => void)[] = [];
  const applied: MessageFrame[] = [];
  const feed = liveFeed(
    () => new Promise<void>((resolve) => reads.push(resolve)),
    (frame) => applied.push(frame),
  );
  const settle = async (n: number) => {
    reads[n]!();
    await Promise.resolve();
    await Promise.resolve();
  };
  return { feed, reads, applied, settle };
}

describe('the live feed over reads of the relay', () => {
  it('holds frames until the last of overlapping reads settles', async () => {
    const { feed, applied, settle } = harness();
    void feed.read();
    void feed.read();
    feed.receive(deleted);
    await settle(0);
    expect(applied).toEqual([]);
    await settle(1);
    expect(applied).toEqual([deleted]);
  });

  it('reads again when the page changed, holding frames meanwhile', async () => {
    const { feed, reads, applied, settle } = harness();
    feed.receive({ type: 'showcase.changed' });
    feed.receive(deleted);
    expect(reads).toHaveLength(1);
    expect(applied).toEqual([]);
    await settle(0);
    expect(applied).toEqual([deleted]);
  });

  it('drops frames held from before the page changed, so the newer read wins', async () => {
    const { feed, applied, settle } = harness();
    const created: ShowcaseFrame = {
      type: 'message.created',
      at: 0,
      message: {
        message_id: '1',
        channel_id: '110000000000000001',
        thread_id: null,
        content: 'Before withdrawing',
        created_at: '2026-10-22T00:00:00.000Z',
        edited_at: null,
        deleted: false,
        removed_by: null,
        author: { kind: 'human', agent_id: null, author_id: 'h_1', display_name: 'Pat' },
      },
    };
    void feed.read();
    feed.receive(created);
    feed.receive({ type: 'showcase.changed' });
    await settle(0);
    await settle(1);
    expect(applied).toEqual([]);
  });
});
