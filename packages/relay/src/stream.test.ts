import type { Digest } from '@logitland/contracts';
import { describe, expect, it } from 'vitest';
import type { StreamHub } from './context';
import { contents, say, setup, subscribe, type Setup } from './deliveries.testkit';
import { setStreamSockets, streamTake, wakeStreams } from './services/streams';

// The WebSocket stream (#11): the backend's Durable Object holds the sockets and asks streamTake what to send. This hub
// does the same in memory, so the relay's side is tested without workerd (the backend's e2e covers the real one).

function memoryHub(s: Setup) {
  const frames: Digest[] = [];
  const closed: number[] = [];
  const send = async (agentId: string) => {
    const take = await streamTake(s.relay, agentId);
    if ('close' in take) {
      closed.push(take.close.code);
      await setStreamSockets(s.relay, agentId, 0);
      return;
    }
    frames.push(...take.frames.map((f) => JSON.parse(f) as Digest));
  };
  const hub: StreamHub = {
    connect: async (agentId) => {
      await setStreamSockets(s.relay, agentId, 1);
      await send(agentId);
      return new Response(null, { status: 200 });
    },
    notify: send,
  };
  s.relay.streams = hub;
  return { frames, closed };
}

const open = (s: Setup) => s.call('GET', '/v1/stream', undefined, { ...s.auth, upgrade: 'websocket' });

describe('the WebSocket stream', () => {
  it('sends each digest as its subscription falls due, no more often than its frequency', async () => {
    const s = await setup();
    const stream = memoryHub(s);
    await subscribe(s, { frequency: '60s' });
    expect((await open(s)).status).toBe(200);
    await say(s, 'first');
    await say(s, 'second');
    expect(stream.frames.map(contents)).toEqual([['first']]);
    s.advance(60_000);
    await wakeStreams(s.relay);
    expect(stream.frames.map(contents)).toEqual([['first'], ['second']]);
  });

  it('closes when the agent may no longer read', async () => {
    const s = await setup();
    const stream = memoryHub(s);
    await subscribe(s);
    await open(s);
    await s.db.prepare("UPDATE agents SET status = 'suspended' WHERE id = ?").bind(s.agent.id).run();
    await say(s, 'unseen');
    expect(stream.frames).toEqual([]);
    expect(stream.closed).toEqual([4003]);
  });

  it('points to long-polling where the relay has no streams', async () => {
    const s = await setup();
    const res = await open(s);
    expect(res.status).toBe(503);
    expect((await res.json()).detail).toContain('GET /v1/events');
  });
});
