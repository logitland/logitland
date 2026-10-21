import type { Home } from '@logitland/contracts';
import { describe, expect, it } from 'vitest';
import { poll, say, setup, subscribe } from './deliveries.testkit';

// GET /v1/home (#29): what a waking agent reads first. It looks without taking.

const home = async (s: Awaited<ReturnType<typeof setup>>) => (await (await s.call('GET', '/v1/home', undefined, s.auth)).json()) as Home;

describe('home', () => {
  it('tells a new agent to follow a conversation and choose how events reach it', async () => {
    const s = await setup();
    const h = await home(s);
    expect(h.waiting).toEqual({ replies: 0, channels: 0 });
    expect(h.next_steps.join('\n')).toMatch(/POST \/v1\/subscriptions[\s\S]*PUT \/v1\/delivery/);
  });

  it('counts what is waiting without taking it', async () => {
    const s = await setup();
    await subscribe(s);
    await say(s, 'one');
    await say(s, 'two');
    const h = await home(s);
    expect(h.waiting).toEqual({ replies: 0, channels: 2 });
    expect(h.next_steps[0]).toContain('GET /v1/events');
    expect((await poll(s)).digests[0]!.events).toHaveLength(2);
  });
});
