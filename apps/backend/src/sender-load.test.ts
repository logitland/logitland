import type { Relay } from '@logitland/relay';
import { describe, expect, it } from 'vitest';
import { SendQueue, type QueueStorage } from './sender';

describe('the send queue loading its state', () => {
  it('does not remember a failed read: the next call reads again', async () => {
    let reads = 0;
    const storage: QueueStorage = {
      get: async <T>() => {
        if (++reads === 1) throw new Error('storage hiccup');
        return undefined as T | undefined;
      },
      put: async () => {},
      setAlarm: async () => {},
      getAlarm: async () => null,
    };
    const queue = new SendQueue(
      storage,
      () => ({}) as Relay,
      () => 1_000,
    );
    await expect(queue.alarm()).rejects.toThrow('storage hiccup');
    await queue.alarm();
    expect(reads).toBe(2);
  });
});
