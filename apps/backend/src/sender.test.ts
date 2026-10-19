import { SecretBox, type Relay } from '@logitland/relay';
import { LOUNGE, SqliteD1, harness, seedAgent, seedChannel } from '@logitland/relay/testing';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import type { Bindings } from './index';
import { ChannelSender, SendQueue, senderClient, type QueueStorage } from './sender';

// The send queue's logic runs here with fake storage and a fake clock. How Durable Object storage and alarms
// behave on workerd is covered by the workerd suite.

function memoryStorage() {
  const data = new Map<string, unknown>();
  const state = { alarm: null as number | null };
  const storage: QueueStorage = {
    get: async <T>(key: string) => structuredClone(data.get(key)) as T | undefined,
    put: async (key, value) => void data.set(key, structuredClone(value)),
    setAlarm: async (t) => void (state.alarm = t),
    getAlarm: async () => state.alarm,
  };
  return { data, state, storage };
}

const okMessage = (id: string, headers: Record<string, string> = {}) =>
  Response.json({ id, channel_id: LOUNGE, content: 'x', timestamp: '2026-10-19T03:00:00.000Z', edited_timestamp: null }, { headers });

async function setup() {
  // The relay's own sender does nothing, so messages stop at `queued`; the queue under test sends them.
  const h = harness({ moderator: { review: async () => ({ verdict: 'pass' }) }, sender: { enqueue: async () => {} } });
  await seedChannel(h.relay, { id: LOUNGE, access: 'post', pace: 120 });
  const agent = await seedAgent(h.relay, { tier: 'claimed' });
  const clock = { t: 1_000_000 };
  const mem = memoryStorage();
  const queue = (storage: QueueStorage = mem.storage, relay: () => Relay = () => h.relay) => new SendQueue(storage, relay, () => clock.t);
  let n = 0;
  const queued = async (text: string) => {
    const res = await h.call(
      'POST',
      '/v1/messages',
      { channel_id: LOUNGE, content: text },
      { ...h.as(agent.key), 'idempotency-key': `sender-key-${++n}-padding` },
    );
    const msg = (await res.json()) as { id: string; status: string };
    expect(msg.status).toBe('queued');
    return msg.id;
  };
  const status = async (id: string) => (await h.db.prepare('SELECT status FROM relay_messages WHERE id = ?').bind(id).first<{ status: string }>())!.status;
  /** The alarm goes off: the platform clears it, moves the clock to its time, and calls the handler. */
  const fire = async (q: SendQueue) => {
    const at = mem.state.alarm;
    expect(at, 'an alarm was set').not.toBeNull();
    mem.state.alarm = null;
    clock.t = at!;
    await q.alarm();
  };
  return { h, agent, clock, mem, queue, queued, status, fire };
}

describe('an idle queue', () => {
  it('sends the message inside the enqueue call and leaves nothing behind', async () => {
    const { h, mem, queue, queued, status } = await setup();
    const id = await queued('straight through');
    await queue().enqueue(id);
    expect(await status(id)).toBe('sent');
    expect(h.discordCalls).toHaveLength(1);
    expect((mem.data.get('state') as { queue: string[] }).queue).toEqual([]);
    expect(mem.state.alarm).toBeNull();
  });

  it('ignores a message that is not queued any more', async () => {
    const { h, queue, queued, status } = await setup();
    const id = await queued('once only');
    const q = queue();
    await q.enqueue(id);
    await q.enqueue(id);
    expect(await status(id)).toBe('sent');
    expect(h.discordCalls).toHaveLength(1);
  });
});

describe('a busy queue', () => {
  it('answers at once, sends in order from its alarm, and leaves the line to the one in front', async () => {
    const { h, clock, mem, queue, queued, status, fire } = await setup();
    const [one, two, three] = [await queued('first in line'), await queued('second in line'), await queued('third in line')];
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    h.setDiscord(async () => {
      await gate;
      return okMessage('300000000000000001');
    });

    const q = queue();
    const first = q.enqueue(one);
    await vi.waitFor(() => expect(h.discordCalls).toHaveLength(1));
    // The first send is in flight: the others return immediately and are not sent.
    await q.enqueue(two);
    await q.enqueue(three);
    expect(h.discordCalls).toHaveLength(1);
    expect(await status(two)).toBe('queued');
    expect((mem.data.get('state') as { queue: string[] }).queue).toEqual([one, two, three]);
    expect(mem.state.alarm).toBe(clock.t + 1000);

    h.setDiscord(async () => okMessage('300000000000000002'));
    release();
    await first;
    expect(await status(one)).toBe('sent');
    expect(await status(two)).toBe('queued');
    expect(mem.state.alarm).not.toBeNull();

    await fire(q);
    expect(await status(two)).toBe('sent');
    expect(await status(three)).toBe('sent');
    const order = h.discordCalls.map(async (c) => ((await c.clone().json()) as { content: string }).content);
    expect(await Promise.all(order)).toEqual(['first in line', 'second in line', 'third in line']);
    expect((mem.data.get('state') as { queue: string[] }).queue).toEqual([]);
  });

  it('does not start a second send while one is running', async () => {
    const { h, queue, queued } = await setup();
    const [one, two] = [await queued('alpha'), await queued('beta')];
    let running = 0;
    let most = 0;
    h.setDiscord(async () => {
      most = Math.max(most, ++running);
      await new Promise((resolve) => setTimeout(resolve, 20));
      running--;
      return okMessage('300000000000000003');
    });
    const q = queue();
    await Promise.all([q.enqueue(one), q.enqueue(two), q.alarm()]);
    expect(most).toBe(1);
  });
});

describe('Discord’s limits', () => {
  it('waits out a 429, keeps the message at the head, and sends once the wait is over', async () => {
    const { h, clock, mem, queue, queued, status } = await setup();
    const [one, two] = [await queued('limited'), await queued('behind it')];
    h.setDiscord(() => new Response(JSON.stringify({ retry_after: 3 }), { status: 429, headers: { 'content-type': 'application/json', 'retry-after': '3' } }));
    const q = queue();
    await q.enqueue(one);
    expect(await status(one)).toBe('queued');
    expect(mem.data.get('state')).toEqual({ queue: [one], notBefore: clock.t + 3000 });
    expect(mem.state.alarm).toBe(clock.t + 3000);

    await q.enqueue(two);
    expect(h.discordCalls).toHaveLength(1);

    // An early wake-up sends nothing and asks for another alarm no earlier than the pause.
    mem.state.alarm = null;
    clock.t += 2999;
    await q.alarm();
    expect(h.discordCalls).toHaveLength(1);
    expect(mem.state.alarm).toBeGreaterThanOrEqual(clock.t + 1);

    h.setDiscord(async () => okMessage('300000000000000004'));
    clock.t += 1;
    await q.alarm();
    expect(await status(one)).toBe('sent');
    expect(await status(two)).toBe('sent');
  });

  it('pauses for the reset time when the bucket is empty, and does not send inline into it', async () => {
    const { h, clock, mem, queue, queued, status } = await setup();
    h.setDiscord(async () => okMessage('300000000000000005', { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset-after': '1.5' }));
    const [one, two] = [await queued('uses the last token'), await queued('has to wait')];
    const q = queue();
    await q.enqueue(one);
    expect(await status(one)).toBe('sent');
    expect(mem.data.get('state')).toEqual({ queue: [], notBefore: clock.t + 1500 });

    await q.enqueue(two);
    expect(await status(two)).toBe('queued');
    expect(h.discordCalls).toHaveLength(1);
    expect(mem.state.alarm).toBe(clock.t + 1500);

    clock.t += 1500;
    await q.alarm();
    expect(await status(two)).toBe('sent');
  });
});

describe('persistence', () => {
  it('survives the Durable Object being evicted: a new instance resumes from storage', async () => {
    const { h, mem, queue, queued, status, fire } = await setup();
    const [one, two] = [await queued('before eviction'), await queued('after eviction')];
    h.setDiscord(() => new Response(JSON.stringify({ retry_after: 5 }), { status: 429, headers: { 'content-type': 'application/json', 'retry-after': '5' } }));
    await queue().enqueue(one);
    await queue().enqueue(two);
    expect(await status(one)).toBe('queued');

    h.setDiscord(async () => okMessage('300000000000000006'));
    await fire(queue());
    expect(await status(one)).toBe('sent');
    expect(await status(two)).toBe('sent');
    expect((mem.data.get('state') as { queue: string[] }).queue).toEqual([]);
  });
});

describe('a message the queue cannot send', () => {
  it('gives up on it after repeated crashes without blocking the line', async () => {
    const { h, clock, mem, queue, queued, status, fire } = await setup();
    const [bad, good] = [await queued('poison'), await queued('innocent bystander')];
    let broken = true;
    const q = queue(mem.storage, () => {
      if (broken) throw new Error('database unreachable');
      return h.relay;
    });
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    await q.enqueue(bad);
    await q.enqueue(good);
    for (let i = 0; i < 4; i++) await fire(q);
    expect((mem.data.get('state') as { queue: string[] }).queue).toEqual([good]);
    broken = false;
    clock.t += 60_000;
    await q.alarm();
    expect(await status(good)).toBe('sent');
    expect(await status(bad)).toBe('queued');
    expect(error.mock.calls.some((c) => String(c[0]).includes('sender.crashed'))).toBe(true);
    error.mockRestore();
  });
});

const migrations = fileURLToPath(new URL('../../../packages/relay/migrations', import.meta.url).href);

describe('the Durable Object', () => {
  const env = (): Bindings =>
    ({
      DB: new SqliteD1().migrate(migrations),
      RELAY_SECRET_KEY: SecretBox.generateKey(),
      INTERNAL_TOKEN: 'test-internal-token',
      PUBLIC_URL: 'https://relay.logitland.test',
      DASHBOARD_URL: 'https://logitland.test',
      RELAY_MODE: 'development',
    }) as unknown as Bindings;

  it('queues through its storage and drops a message that is not in the database', async () => {
    const mem = memoryStorage();
    const sender = new ChannelSender({ storage: mem.storage } as unknown as DurableObjectState, env());
    await sender.enqueue('msg_NOSUCHMESSAGE0');
    expect((mem.data.get('state') as { queue: string[] }).queue).toEqual([]);
  });

  it('is reached by channel ID through the client', async () => {
    const enqueue = vi.fn(async () => {});
    const names: string[] = [];
    const ns = { idFromName: (name: string) => (names.push(name), { name }), get: () => ({ enqueue }) } as unknown as DurableObjectNamespace<ChannelSender>;
    await senderClient(ns).enqueue(LOUNGE, 'msg_X');
    expect(names).toEqual([LOUNGE]);
    expect(enqueue).toHaveBeenCalledWith('msg_X');
  });
});
