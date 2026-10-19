import { describe, expect, it, vi } from 'vitest';
import {
  CONTINUE_MS,
  GatewayService,
  QUERY_BUDGET,
  SEED_CHECK_MS,
  STOP_RETRY_MS,
  WAKE_MS,
  type GatewayHost,
  type GatewaySocket,
  type SocketEvents,
} from './gateway';
import { NEWS, all, at, conversation, moreChannels, msg, one, subscribe, world } from './intake-fixtures';
import { BENCH, FORUM, GUILD as GUILD_ID, LOUNGE, type Harness } from './testing';

// WebCrypto answers on the thread pool, so the work behind a dispatch takes a few turns of the event loop.
const settle = () => new Promise((resolve) => setTimeout(resolve, 30));
const AUTHOR = { id: '200000000000000001', username: 'luna', global_name: 'Luna' };
const THREAD = '120000000000000001';

class FakeSocket implements GatewaySocket {
  sent: { op: number; d: any }[] = [];
  closed: number | null = null;
  send(data: string) {
    this.sent.push(JSON.parse(data));
  }
  close(code: number) {
    this.closed = code;
  }
}

function clockFor(h: Harness) {
  let timers: { at: number; fn: () => void; live: boolean }[] = [];
  let now = h.now().getTime();
  return {
    now: () => now,
    setTimer: (fn: () => void, ms: number) => {
      const t = { at: now + ms, fn, live: true };
      timers.push(t);
      return () => {
        t.live = false;
      };
    },
    // Lets work already started finish (it may schedule timers) before deciding what is due.
    async advance(ms: number) {
      await settle();
      const target = now + ms;
      for (;;) {
        const next = timers.filter((t) => t.live && t.at <= target).sort((a, b) => a.at - b.at)[0];
        if (!next) break;
        h.advance(next.at - now);
        now = next.at;
        next.live = false;
        next.fn();
        await settle();
      }
      h.advance(target - now);
      now = target;
      timers = timers.filter((t) => t.live);
    },
  };
}

type Clock = ReturnType<typeof clockFor>;

/** One service wired to a fake socket and fake storage. Pass the same storage and clock to simulate a restart. */
function service(h: Harness, clock: Clock, storage = new Map<string, unknown>(), bufferCap?: number) {
  const connections: { url: string; socket: FakeSocket; events: SocketEvents }[] = [];
  const wakes: number[] = [];
  const failures = { puts: 0 };
  const host: GatewayHost = {
    relay: h.relay,
    token: 'bot-token',
    storage: {
      get: async <T>(key: string) => storage.get(key) as T | undefined,
      put: async (key, value) => {
        if (failures.puts > 0 && key === 'session') {
          failures.puts--;
          throw new Error('storage is down');
        }
        storage.set(key, structuredClone(value));
      },
      delete: async (key) => storage.delete(key),
    },
    connect: async (url, events) => {
      const socket = new FakeSocket();
      connections.push({ url, socket, events });
      return socket;
    },
    setTimer: clock.setTimer,
    wakeAt: async (t) => void wakes.push(t),
    now: clock.now,
    random: () => 0.5,
    ...(bufferCap ? { bufferCap } : {}),
  };
  const svc = new GatewayService(host);
  const last = () => connections[connections.length - 1]!;
  const send = (frame: object, i = connections.length - 1) => connections[i]!.events.message(JSON.stringify(frame));
  return {
    svc,
    storage,
    connections,
    wakes,
    failures,
    last,
    send,
    hello: () => send({ op: 10, d: { heartbeat_interval: 41_250 } }),
    dispatch: (t: string, s: number, d: object) => send({ op: 0, t, s, d }),
    ready: (s = 1, session = 'sess-1') => send({ op: 0, t: 'READY', s, d: { session_id: session, resume_gateway_url: 'wss://resume.discord.gg' } }),
    message: (s: number, n: number, over: Record<string, unknown> = {}) =>
      send({
        op: 0,
        t: 'MESSAGE_CREATE',
        s,
        d: { id: msg(n), channel_id: LOUNGE, guild_id: GUILD_ID, author: AUTHOR, content: `message ${n}`, timestamp: at(0, n), type: 0, ...over },
      }),
    state: () =>
      one<{
        status: string;
        session_id: string | null;
        seq: number | null;
        last_event_at: string | null;
        last_error: string | null;
        last_heartbeat_at: string | null;
      }>(h, "SELECT * FROM intake_state WHERE source = 'gateway'"),
  };
}

/** Scripts Discord's REST answers the gateway service needs. */
function discord(
  h: Harness,
  over: { gatewayBot?: Response; messages?: (channel: string, after: string | null) => unknown[]; channels?: Record<string, unknown> } = {},
) {
  const calls: string[] = [];
  h.setDiscord(async (req) => {
    const url = new URL(req.url);
    calls.push(`${req.method} ${url.pathname.replace('/api/v10', '')}${url.search}`);
    if (url.pathname.endsWith('/gateway/bot'))
      return (
        over.gatewayBot ??
        Response.json({
          url: 'wss://gateway.discord.gg',
          shards: 1,
          session_start_limit: { total: 1000, remaining: 999, reset_after: 3_600_000, max_concurrency: 1 },
        })
      );
    const messages = /\/channels\/(\d+)\/messages$/.exec(url.pathname);
    if (messages) return Response.json(over.messages?.(messages[1]!, url.searchParams.get('after')) ?? []);
    const channel = /\/channels\/(\d+)$/.exec(url.pathname);
    if (channel)
      return over.channels?.[channel[1]!]
        ? Response.json(over.channels[channel[1]!])
        : Response.json({ message: 'Unknown Channel', code: 10003 }, { status: 404 });
    return new Response('unexpected', { status: 500 });
  });
  return calls;
}

describe('connecting and recording', () => {
  it('connects, identifies, records dispatches in order after the flush delay, and mirrors health', async () => {
    const { h } = await world();
    const clock = clockFor(h);
    const calls = discord(h);
    const g = service(h, clock);
    await g.svc.ensure();
    // A channel with no cursor is looked at once, so the mirror isn't empty.
    expect(calls).toEqual(['GET /gateway/bot', `GET /channels/${LOUNGE}/messages?limit=100`]);
    expect(g.last().url).toBe('wss://gateway.discord.gg/?v=10&encoding=json');
    expect((await g.state())!.status).toBe('connecting');

    g.hello();
    expect(g.last().socket.sent[0]).toMatchObject({ op: 2, d: { token: 'bot-token', intents: 33281 } });
    g.ready(1);
    await settle();
    expect(await g.state()).toMatchObject({ status: 'connected', session_id: 'sess-1', seq: 1, last_event_at: null });

    g.message(2, 1);
    g.message(3, 2);
    await settle();
    expect(await conversation(h, 1)).toBeNull();
    await clock.advance(500);
    expect((await all<{ id: string }>(h, 'SELECT CAST(message_id AS TEXT) AS id FROM conversation ORDER BY message_id')).map((r) => r.id)).toEqual([
      msg(1),
      msg(2),
    ]);
    expect(await all(h, 'SELECT type FROM events ORDER BY seq')).toHaveLength(2);
    expect(g.storage.get('session')).toEqual({ sessionId: 'sess-1', resumeUrl: 'wss://resume.discord.gg', seq: 3 });
    expect(g.wakes.at(-1)! - clock.now()).toBeLessThanOrEqual(WAKE_MS);

    // Health is mirrored at most every 15 seconds, so the next write after that carries the news.
    await clock.advance(16_000);
    g.message(4, 3);
    await clock.advance(500);
    expect(await g.state()).toMatchObject({ status: 'connected', seq: 4, last_event_at: expect.any(String), last_error: null });
  });

  it('writes as soon as 50 events are waiting', async () => {
    const { h } = await world();
    const clock = clockFor(h);
    discord(h);
    const g = service(h, clock);
    await g.svc.ensure();
    g.hello();
    g.ready(1);
    for (let i = 1; i <= 50; i++) g.message(i + 1, i);
    // No timer has been advanced: the batch size alone triggered the write.
    await vi.waitFor(async () => expect(await all(h, 'SELECT 1 FROM conversation')).toHaveLength(50), { timeout: 5_000 });
  });

  it('answers status() with what the admin page shows', async () => {
    const { h } = await world();
    const clock = clockFor(h);
    discord(h);
    const g = service(h, clock);
    await g.svc.ensure();
    g.hello();
    g.ready(1);
    g.message(2, 1);
    await settle();
    expect(g.svc.snapshot()).toMatchObject({ status: 'connected', resumable: true, buffered: 1, backfill_pending: false, last_error: null });
    await clock.advance(41_250);
    g.send({ op: 11 });
    expect((g.svc.snapshot() as { last_heartbeat_at: string }).last_heartbeat_at).toBe(h.now().toISOString());
    await clock.advance(20_000);
    expect(await g.state()).toMatchObject({ last_heartbeat_at: expect.any(String) });
  });

  it('does not connect twice when ensure is called again', async () => {
    const { h } = await world();
    const clock = clockFor(h);
    discord(h);
    const g = service(h, clock);
    await g.svc.ensure();
    g.hello();
    g.ready(1);
    await g.svc.ensure();
    await g.svc.tick();
    expect(g.connections).toHaveLength(1);
  });
});

describe('restarts', () => {
  it('resumes from the last sequence it wrote down, not the last it received', async () => {
    const { h } = await world();
    const clock = clockFor(h);
    discord(h);
    const storage = new Map<string, unknown>();
    const first = service(h, clock, storage);
    await first.svc.ensure();
    first.hello();
    first.ready(1);
    first.message(2, 1);
    await clock.advance(500);
    // This one arrives but the Durable Object is evicted before it is written.
    first.message(3, 2);
    await settle();
    expect(await conversation(h, 2)).toBeNull();
    expect(storage.get('session')).toMatchObject({ sessionId: 'sess-1', seq: 2 });

    const second = service(h, clock, storage);
    await second.svc.ensure();
    expect(second.last().url).toBe('wss://resume.discord.gg/?v=10&encoding=json');
    second.hello();
    expect(second.last().socket.sent).toEqual([{ op: 6, d: { token: 'bot-token', session_id: 'sess-1', seq: 2 } }]);
    // Discord replays the one that was lost, and it lands once.
    second.dispatch('RESUMED', 3, {});
    second.message(3, 2);
    second.message(4, 1);
    await clock.advance(500);
    expect((await all<{ id: string }>(h, 'SELECT CAST(message_id AS TEXT) AS id FROM conversation ORDER BY message_id')).map((r) => r.id)).toEqual([
      msg(1),
      msg(2),
    ]);
    expect(await all(h, 'SELECT 1 FROM events')).toHaveLength(2);
    // A resumed session is not a gap.
    expect(await all(h, "SELECT 1 FROM events WHERE type = 'subscription.gap'")).toHaveLength(0);
    expect((await second.state())!.status).toBe('connected');
  });

  it('wakes from the alarm after an eviction and reconnects', async () => {
    const { h } = await world();
    const clock = clockFor(h);
    discord(h);
    const storage = new Map<string, unknown>();
    const first = service(h, clock, storage);
    await first.svc.ensure();
    first.hello();
    first.ready(1);
    const second = service(h, clock, storage);
    await second.svc.tick();
    expect(second.connections).toHaveLength(1);
    expect(second.last().url).toContain('resume.discord.gg');
  });

  it('reconnects a connection that has gone quiet', async () => {
    const { h } = await world();
    const clock = clockFor(h);
    discord(h);
    const g = service(h, clock);
    await g.svc.ensure();
    g.hello();
    g.ready(1);
    await clock.advance(2 * 41_250 + 16_000);
    // The heartbeat timer would have caught this first; the alarm backstop covers a timer that never fired.
    await g.svc.ensure();
    expect(g.connections.length).toBeGreaterThanOrEqual(2);
  });
});

describe('a lost session', () => {
  async function lost(opts: { pages?: (channel: string, after: string | null) => unknown[] } = {}) {
    const w = await world();
    const { h } = w;
    const clock = clockFor(h);
    const calls = discord(h, { messages: opts.pages });
    const storage = new Map<string, unknown>();
    const first = service(h, clock, storage);
    await first.svc.ensure();
    first.hello();
    first.ready(1);
    first.message(2, 1);
    first.message(3, 2);
    await settle();
    const lastEvent = h.now().toISOString();
    await clock.advance(500);
    await clock.advance(5 * 60_000);

    // Resume is refused: the session is gone.
    const second = service(h, clock, storage);
    await second.svc.ensure();
    second.hello();
    second.send({ op: 9, d: false });
    await clock.advance(5_000);
    await settle();
    return { ...w, clock, calls, storage, second, lastEvent };
  }

  it('starts afresh, records a gap per open channel from the last event to now, and fetches what was missed', async () => {
    const pages = (_channel: string, after: string | null) =>
      after === msg(2)
        ? [{ id: msg(4), channel_id: LOUNGE, author: AUTHOR, content: 'while you were away', timestamp: at(3), type: 0, edited_timestamp: null }]
        : [];
    const { h, second, calls, lastEvent } = await lost({ pages });
    expect(second.connections.at(-1)!.url).toContain('gateway.discord.gg');
    second.hello();
    expect(second.last().socket.sent[0]!.op).toBe(2);
    second.ready(1, 'sess-2');
    await settle();
    await settle();

    const gaps = await all<{ channel_id: string; payload: string; seq: number }>(
      h,
      "SELECT channel_id, payload, seq FROM events WHERE type = 'subscription.gap'",
    );
    expect(gaps.map((g) => g.channel_id)).toEqual([LOUNGE]);
    const data = JSON.parse(gaps[0]!.payload).data;
    expect(data).toMatchObject({ window_start: lastEvent, window_end: h.now().toISOString(), resume_cursor: String(gaps[0]!.seq) });
    expect(data.reason).toContain('edits and deletions made during it can’t be recovered');

    expect(calls.filter((c) => c.includes('after='))).toEqual([`GET /channels/${LOUNGE}/messages?limit=100&after=${msg(2)}`]);
    expect(await conversation(h, 4)).toMatchObject({ content: 'while you were away', author_kind: 'human' });
    const created = await all<{ seq: number; type: string }>(h, "SELECT seq, type FROM events WHERE type IN ('message.created') ORDER BY seq");
    expect(created.at(-1)!.seq).toBeGreaterThan(gaps[0]!.seq);
    expect(second.storage.get('backfill')).toBeUndefined();
    expect(second.svc.snapshot().backfill_pending).toBe(false);
  });

  it('backfills from where the relay was before the gap, even after new messages arrive live', async () => {
    const { h, second, calls, clock } = await lost({ pages: () => [] });
    second.hello();
    second.ready(1, 'sess-2');
    // A live message in the new session lands first and moves the channel's cursor ahead.
    second.message(2, 9);
    await clock.advance(500);
    await vi.waitFor(async () => expect(await conversation(h, 9)).not.toBeNull());
    expect(calls.filter((c) => c.includes('after='))).toEqual([`GET /channels/${LOUNGE}/messages?limit=100&after=${msg(2)}`]);
  });

  it('pages through a long gap oldest first, a share per run within the D1 query budget, and carries on at the next alarm', async () => {
    const all_ = Array.from({ length: 450 }, (_, i) => msg(100 + i));
    const pages = (_channel: string, after: string | null) => {
      if (after === null) return [];
      const from = after === msg(2) ? 0 : all_.indexOf(after) + 1;
      // Discord answers newest first.
      return all_
        .slice(from, from + 100)
        .reverse()
        .map((id) => ({ id, channel_id: LOUNGE, author: AUTHOR, content: `m ${id}`, timestamp: at(3), type: 0, edited_timestamp: null }));
    };
    const { h, second, clock } = await lost({ pages });
    const runs = () => h.log.lines.filter((l) => l.event === 'gateway.backfill');
    second.hello();
    second.ready(1, 'sess-2');
    await vi.waitFor(() => expect(runs()).toHaveLength(1), { timeout: 5_000 });
    // The first run stopped on its query budget, well short of the 10-page cap, and left the rest for the next alarm.
    const first = runs()[0]!.fields as { pages: number; messages: number; queries: number };
    expect(first.pages).toBeGreaterThan(0);
    expect(first.pages).toBeLessThan(10);
    expect(first.queries).toBeLessThanOrEqual(QUERY_BUDGET + 150);
    expect(second.svc.snapshot().backfill_pending).toBe(true);
    expect(second.storage.get('backfill')).toEqual({ [LOUNGE]: msg(100 + first.messages - 1) });
    expect(second.wakes.at(-1)! - clock.now()).toBe(CONTINUE_MS);

    for (let run = 1; run < 6 && second.svc.snapshot().backfill_pending; run++) {
      await second.svc.tick();
      await vi.waitFor(() => expect(runs()).toHaveLength(run + 1), { timeout: 5_000 });
      expect((runs()[run]!.fields as { queries: number }).queries).toBeLessThanOrEqual(QUERY_BUDGET + 150);
    }
    await vi.waitFor(async () => expect(await all(h, 'SELECT 1 FROM conversation WHERE message_id >= ?', msg(100))).toHaveLength(450), { timeout: 5_000 });
    expect(second.svc.snapshot().backfill_pending).toBe(false);
    // The log keeps Discord’s order: oldest first.
    const ids = (
      await all<{ message_id: string }>(h, "SELECT CAST(message_id AS TEXT) AS message_id FROM events WHERE type = 'message.created' ORDER BY seq")
    ).map((e) => e.message_id);
    expect(ids.slice(2)).toEqual(all_);
  });

  it('keeps going later if Discord rate limits the fetch', async () => {
    const w = await world();
    const { h } = w;
    const clock = clockFor(h);
    let limited = true;
    const calls: string[] = [];
    h.setDiscord(async (req) => {
      const url = new URL(req.url);
      calls.push(url.pathname);
      if (url.pathname.endsWith('/gateway/bot'))
        return Response.json({
          url: 'wss://gateway.discord.gg',
          shards: 1,
          session_start_limit: { total: 1000, remaining: 999, reset_after: 1, max_concurrency: 1 },
        });
      if (limited) return Response.json({ retry_after: 3, global: false }, { status: 429, headers: { 'retry-after': '3' } });
      return Response.json([{ id: msg(50), channel_id: LOUNGE, author: AUTHOR, content: 'late', timestamp: at(3), type: 0, edited_timestamp: null }]);
    });
    const storage = new Map<string, unknown>();
    const first = service(h, clock, storage);
    await first.svc.ensure();
    first.hello();
    first.ready(1);
    first.message(2, 1);
    await clock.advance(500);
    await clock.advance(60_000);
    const second = service(h, clock, storage);
    await second.svc.ensure();
    second.hello();
    second.send({ op: 9, d: false });
    await clock.advance(5_000);
    second.hello();
    second.ready(1, 'sess-2');
    await settle();
    await settle();
    expect(second.svc.snapshot().backfill_pending).toBe(true);
    expect(await conversation(h, 50)).toBeNull();
    limited = false;
    await clock.advance(3_100);
    await settle();
    expect(await conversation(h, 50)).toMatchObject({ content: 'late' });
    expect(second.svc.snapshot().backfill_pending).toBe(false);
  });

  it('does not treat the very first connection as a gap', async () => {
    const { h } = await world();
    const clock = clockFor(h);
    const calls = discord(h);
    const g = service(h, clock);
    await g.svc.ensure();
    g.hello();
    g.ready(1);
    await settle();
    expect(await all(h, "SELECT 1 FROM events WHERE type = 'subscription.gap'")).toHaveLength(0);
    expect(calls.filter((c) => c.includes('after='))).toHaveLength(0);
    expect(calls.filter((c) => c.includes('/messages'))).toHaveLength(1);
  });
});

describe('when the Gateway says no', () => {
  it('stops for good on a disallowed intent, says how to fix it, and tries again after ten minutes', async () => {
    const { h } = await world();
    const clock = clockFor(h);
    discord(h);
    const storage = new Map<string, unknown>();
    const g = service(h, clock, storage);
    await g.svc.ensure();
    g.hello();
    g.last().events.close(4014, 'Disallowed intent(s)');
    await settle();
    const status = 'stopped: enable the Message Content intent in the Developer Portal (Bot, Privileged Gateway Intents)';
    expect(await g.state()).toMatchObject({ status, last_error: 'Discord closed the connection with code 4014' });

    await g.svc.ensure();
    await clock.advance(9 * 60_000);
    await g.svc.ensure();
    expect(g.connections).toHaveLength(1);
    expect(g.wakes.at(-1)).toBe((g.storage.get('stoppedAt')! as number) + STOP_RETRY_MS);

    // A restart doesn't forget it, and the admin page still says why.
    const again = service(h, clock, storage);
    await again.svc.ensure();
    expect(again.connections).toHaveLength(0);
    expect(again.svc.snapshot().status).toBe(status);

    await clock.advance(61_000);
    await again.svc.ensure();
    expect(again.connections).toHaveLength(1);
    again.hello();
    again.ready(1);
    await settle();
    expect((await again.state())!.status).toBe('connected');
    expect(storage.has('stoppedAt')).toBe(false);
  });

  it('stops on a rejected bot token, whether Discord says so over REST or on the socket', async () => {
    const { h } = await world();
    const clock = clockFor(h);
    discord(h, { gatewayBot: Response.json({ message: '401: Unauthorized', code: 0 }, { status: 401 }) });
    const g = service(h, clock);
    await g.svc.ensure();
    expect(g.connections).toHaveLength(0);
    expect((await g.state())!.status).toBe('stopped: Discord rejected the bot token. Check DISCORD_BOT_TOKEN');
  });

  it('waits when Discord’s limit on new sessions is used up', async () => {
    const { h } = await world();
    const clock = clockFor(h);
    discord(h, {
      gatewayBot: Response.json({
        url: 'wss://gateway.discord.gg',
        shards: 1,
        session_start_limit: { total: 1000, remaining: 0, reset_after: 20 * 60_000, max_concurrency: 1 },
      }),
    });
    const g = service(h, clock);
    await g.svc.ensure();
    expect(g.connections).toHaveLength(0);
    expect((await g.state())!.status).toBe('waiting: Discord’s limit on new sessions is used up, trying again in 20 min');
    await g.svc.ensure();
    expect(g.connections).toHaveLength(0);
  });
});

describe('threads', () => {
  it('maps thread messages to their parent channel, from GUILD_CREATE or from a lookup when the thread is unknown', async () => {
    const { h } = await world();
    const clock = clockFor(h);
    const calls = discord(h, {
      channels: {
        '120000000000000009': { id: '120000000000000009', guild_id: GUILD_ID, parent_id: LOUNGE, name: 'surprise', type: 11 },
        '110000000000000077': { id: '110000000000000077', guild_id: GUILD_ID, name: 'elsewhere', type: 0 },
      },
    });
    const g = service(h, clock);
    await g.svc.ensure();
    g.hello();
    g.ready(1);
    g.dispatch('GUILD_CREATE', 2, {
      id: GUILD_ID,
      channels: [{ id: LOUNGE, type: 0 }],
      threads: [{ id: THREAD, guild_id: GUILD_ID, parent_id: LOUNGE, name: 'planning', type: 11 }],
    });
    g.message(3, 1, { channel_id: THREAD });
    g.message(4, 2, { channel_id: '120000000000000009' });
    g.message(5, 3, { channel_id: '110000000000000077' });
    g.message(6, 4, { channel_id: '110000000000000077' });
    g.message(7, 5);
    await clock.advance(500);
    expect(await conversation(h, 1)).toMatchObject({ channel_id: LOUNGE, thread_id: THREAD });
    expect(await conversation(h, 2)).toMatchObject({ channel_id: LOUNGE, thread_id: '120000000000000009' });
    expect(await conversation(h, 3)).toBeNull();
    expect(await conversation(h, 5)).toMatchObject({ channel_id: LOUNGE, thread_id: null });
    expect((await all<{ id: string }>(h, 'SELECT CAST(id AS TEXT) AS id FROM threads ORDER BY id')).map((t) => t.id)).toEqual([THREAD, '120000000000000009']);
    // The lookups happen once per unknown channel.
    expect(calls.filter((c) => c.startsWith('GET /channels/1') && !c.includes('messages')).sort()).toEqual([
      'GET /channels/110000000000000077',
      'GET /channels/120000000000000009',
    ]);
  });
});

describe('a forum post whose message arrives before the thread is announced', () => {
  it('is filed in its own thread, with the tags Discord reports, and the thread is recorded', async () => {
    const { h } = await world();
    await moreChannels(h);
    const POST = msg(30);
    const clock = clockFor(h);
    discord(h, {
      channels: {
        [POST]: {
          id: POST,
          guild_id: GUILD_ID,
          parent_id: FORUM,
          name: 'my post',
          type: 11,
          applied_tags: ['140000000000000001'],
          thread_metadata: { archived: false, locked: false, create_timestamp: '2026-10-19T02:59:00+00:00' },
        },
      },
    });
    const g = service(h, clock);
    await g.svc.ensure();
    g.hello();
    g.ready(1);
    g.message(2, 30, { channel_id: POST });
    await clock.advance(500);
    expect(await conversation(h, 30)).toMatchObject({ channel_id: FORUM, thread_id: POST });
    expect(await one(h, 'SELECT CAST(id AS TEXT) AS id, parent_id, name, message_count, applied_tags FROM threads')).toEqual({
      id: POST,
      parent_id: FORUM,
      name: 'my post',
      message_count: 1,
      applied_tags: '["140000000000000001"]',
    });
  });
});

describe('when writing fails', () => {
  it('keeps what it has, does not move the stored sequence, and sends it again', async () => {
    const { h } = await world();
    const clock = clockFor(h);
    discord(h);
    const g = service(h, clock);
    await g.svc.ensure();
    g.hello();
    g.ready(1);
    const batch = h.db.batch.bind(h.db);
    h.db.batch = async () => {
      throw new Error('D1 is down');
    };
    g.message(2, 1);
    await clock.advance(500);
    expect(await conversation(h, 1)).toBeNull();
    expect(g.storage.get('session')).toMatchObject({ seq: 1 });
    expect(g.svc.snapshot()).toMatchObject({ buffered: 1, last_error: 'Writing events to the database failed; retrying' });

    h.db.batch = batch;
    await clock.advance(5_000);
    expect(await conversation(h, 1)).not.toBeNull();
    expect(g.storage.get('session')).toMatchObject({ seq: 2 });
    expect(g.svc.snapshot().buffered).toBe(0);
  });

  it('keeps flushing after a failure to write the resume point', async () => {
    const { h } = await world();
    const clock = clockFor(h);
    discord(h);
    const g = service(h, clock);
    await g.svc.ensure();
    g.hello();
    g.ready(1);
    await settle();
    g.failures.puts = 1;
    g.message(2, 1);
    await clock.advance(500);
    // The events were written; only the stored sequence is behind, and the error was logged.
    expect(await conversation(h, 1)).not.toBeNull();
    expect(h.log.lines.some((l) => l.event === 'gateway.flush_failed')).toBe(true);
    g.message(3, 2);
    await clock.advance(5_000);
    expect(await conversation(h, 2)).not.toBeNull();
    expect(g.storage.get('session')).toMatchObject({ seq: 3 });
  });

  it('flushes what was buffered under the old session before the gap event of a new one', async () => {
    const { h } = await world();
    const clock = clockFor(h);
    discord(h);
    const storage = new Map<string, unknown>();
    const g = service(h, clock, storage);
    await g.svc.ensure();
    g.hello();
    g.ready(1);
    g.message(2, 1);
    await settle();
    // Still buffered when the session is invalidated.
    g.send({ op: 9, d: false });
    await clock.advance(5_000);
    g.hello();
    g.ready(1, 'sess-2');
    await settle();
    await settle();
    const types = (await all<{ type: string }>(h, 'SELECT type FROM events ORDER BY seq')).map((e) => e.type);
    expect(types).toEqual(['message.created', 'subscription.gap']);
  });
});

describe('a channel new to the relay', () => {
  it('has its latest page fetched once, and kept for readers without being announced', async () => {
    const { h } = await world();
    await h.db.prepare("UPDATE channels SET agent_access = 'off' WHERE id = ?").bind(LOUNGE).run();
    const clock = clockFor(h);
    const calls = discord(h, {
      messages: (_channel, after) =>
        after === null
          ? [
              { id: msg(2), channel_id: LOUNGE, author: AUTHOR, content: 'two', timestamp: at(0, 2), type: 0 },
              { id: msg(1), channel_id: LOUNGE, author: AUTHOR, content: 'one', timestamp: at(0, 1), type: 0 },
            ]
          : [],
    });
    const g = service(h, clock);
    await g.svc.ensure();
    await settle();
    expect(calls.filter((c) => c.includes('/messages'))).toEqual([]);

    // An admin opens the channel; the first ensure (cron, or the alarm) after SEED_CHECK_MS looks at it.
    await h.db.prepare("UPDATE channels SET agent_access = 'read_only' WHERE id = ?").bind(LOUNGE).run();
    await g.svc.ensure();
    await settle();
    expect(calls.filter((c) => c.includes('/messages'))).toEqual([]);
    await clock.advance(SEED_CHECK_MS);
    await g.svc.ensure();
    await vi.waitFor(async () => expect(await conversation(h, 2)).not.toBeNull());
    expect(calls.filter((c) => c.includes('/messages'))).toEqual([`GET /channels/${LOUNGE}/messages?limit=100`]);
    expect((await conversation(h, 1))!.content).toBe('one');
    expect(await all(h, 'SELECT 1 FROM events')).toHaveLength(0);

    await g.svc.ensure();
    await settle();
    await g.svc.ensure();
    await settle();
    expect(calls.filter((c) => c.includes('/messages'))).toHaveLength(1);
  });

  it('looks at every new channel, with a few REST calls', async () => {
    const { h } = await world();
    await moreChannels(h);
    await h.db.prepare("UPDATE channels SET type = 'text', agent_access = 'read_only' WHERE id != ?").bind(BENCH).run();
    const clock = clockFor(h);
    const calls = discord(h);
    const g = service(h, clock);
    await g.svc.ensure();
    await settle();
    expect(calls.filter((c) => c.includes('/messages')).length).toBe(4);
  });
});

describe('a channel that changes in Discord', () => {
  it('has its name refreshed from CHANNEL_UPDATE and from GUILD_CREATE', async () => {
    const { h } = await world();
    const clock = clockFor(h);
    discord(h);
    const g = service(h, clock);
    await g.svc.ensure();
    g.hello();
    g.ready(1);
    g.dispatch('CHANNEL_UPDATE', 2, { id: LOUNGE, guild_id: GUILD_ID, name: 'common-room', type: 0 });
    await clock.advance(500);
    expect(await one(h, 'SELECT name, type FROM channels WHERE id = ?', LOUNGE)).toEqual({ name: 'common-room', type: 'text' });

    g.dispatch('GUILD_CREATE', 3, {
      id: GUILD_ID,
      channels: [
        { id: LOUNGE, guild_id: GUILD_ID, name: 'lounge-again', type: 5 },
        { id: BENCH, guild_id: GUILD_ID, name: 'not relayed', type: 0 },
      ],
      threads: [],
    });
    await clock.advance(500);
    expect(await one(h, 'SELECT name, type FROM channels WHERE id = ?', LOUNGE)).toEqual({ name: 'lounge-again', type: 'announcement' });
    expect(await one(h, 'SELECT name FROM channels WHERE id = ?', BENCH)).toEqual({ name: 'bench' });
  });
});

describe('a full buffer', () => {
  async function outage(cap = 100) {
    const w = await world();
    const { h } = w;
    const clock = clockFor(h);
    const calls = discord(h, {
      // Whatever the relay missed, Discord still has: messages 2 to 31, as the oldest page after message 1.
      messages: (_channel, after) =>
        after === msg(1)
          ? Array.from({ length: 30 }, (_, i) => ({
              id: msg(31 - i),
              channel_id: LOUNGE,
              author: AUTHOR,
              content: `message ${31 - i}`,
              timestamp: at(0, 31 - i),
              type: 0,
            }))
          : [],
    });
    const storage = new Map<string, unknown>();
    const g = service(h, clock, storage, cap);
    await g.svc.ensure();
    g.hello();
    g.ready(1);
    g.message(2, 1);
    await clock.advance(500);
    expect(await conversation(h, 1)).not.toBeNull();
    return { ...w, clock, calls, storage, g };
  }

  it('drops the oldest events past the cap, remembers which channels they were in, and records a gap once the database answers', async () => {
    const { h, clock, calls, storage, g } = await outage();
    const batch = h.db.batch.bind(h.db);
    h.db.batch = async () => {
      throw new Error('D1 is down');
    };
    for (let n = 2; n <= 131; n++) g.message(n + 1, n);
    await settle();
    await clock.advance(500);
    expect(g.svc.snapshot()).toMatchObject({ buffered: 100, events_dropped: true });
    expect(storage.get('lost')).toMatchObject({ channels: [LOUNGE] });
    // The stored sequence hasn't moved past what is safely written.
    expect(storage.get('session')).toMatchObject({ seq: 2 });

    h.db.batch = batch;
    await clock.advance(5_000);
    await vi.waitFor(async () => expect(await conversation(h, 131)).not.toBeNull(), { timeout: 5_000 });
    expect(g.svc.snapshot()).toMatchObject({ buffered: 0, events_dropped: false });
    expect(storage.has('lost')).toBe(false);

    // A gap for #lounge that covers the dropped events, recorded before the events that were kept.
    const gaps = await all<{ seq: number; payload: string }>(h, "SELECT seq, payload FROM events WHERE type = 'subscription.gap'");
    expect(gaps).toHaveLength(1);
    const data = JSON.parse(gaps[0]!.payload).data;
    expect(data.window_start < data.window_end || data.window_start === data.window_end).toBe(true);
    const firstKept = await one<{ seq: number }>(h, "SELECT MIN(seq) AS seq FROM events WHERE type = 'message.created' AND seq > ?", gaps[0]!.seq);
    expect(firstKept!.seq).toBeGreaterThan(gaps[0]!.seq);

    // And the messages that were dropped are fetched from Discord, starting where the relay stood before.
    await vi.waitFor(async () => expect(await conversation(h, 31)).not.toBeNull(), { timeout: 5_000 });
    expect(calls.some((c) => c.includes(`after=${msg(1)}`))).toBe(true);
    for (const n of [2, 15, 31, 32, 131]) expect(await conversation(h, n)).not.toBeNull();
    expect(await all(h, 'SELECT 1 FROM conversation')).toHaveLength(131);
  });

  it('keeps the loss across an eviction and makes up for it when the object wakes', async () => {
    const { h, clock, storage, g } = await outage();
    const batch = h.db.batch.bind(h.db);
    h.db.batch = async () => {
      throw new Error('D1 is down');
    };
    for (let n = 2; n <= 131; n++) g.message(n + 1, n);
    await settle();
    expect(storage.has('lost')).toBe(true);
    g.svc.shutdown();

    // A new instance, with the database back.
    h.db.batch = batch;
    const second = service(h, clock, storage, 100);
    await second.svc.ensure();
    await vi.waitFor(async () => expect((await all(h, "SELECT 1 FROM events WHERE type = 'subscription.gap'")).length).toBe(1), { timeout: 5_000 });
    expect(storage.has('lost')).toBe(false);
  });

  it('keeps events from being dropped while there is room', async () => {
    const { h, clock, g } = await outage(500);
    for (let n = 2; n <= 131; n++) g.message(n + 1, n);
    await clock.advance(500);
    await vi.waitFor(async () => expect(await all(h, 'SELECT 1 FROM conversation')).toHaveLength(131), { timeout: 5_000 });
    expect(await all(h, "SELECT 1 FROM events WHERE type = 'subscription.gap'")).toHaveLength(0);
    expect(g.svc.snapshot().events_dropped).toBe(false);
  });
});

describe('a backlog of events', () => {
  it('is written a share per flush, within the D1 query budget, and the rest at the next alarm', async () => {
    const { h, agent } = await world();
    // Three subscribers per event make every event cost a fan-out each, so a round of 100 is expensive.
    for (let i = 0; i < 3; i++) await subscribe(h, agent.id);
    const hook = { author: { id: '600000000000000555', username: 'hook', bot: true }, webhook_id: '600000000000000555' };
    const clock = clockFor(h);
    discord(h);
    const g = service(h, clock);
    await g.svc.ensure();
    g.hello();
    g.ready(1);
    await settle();
    // The database is out of reach while 300 events arrive; nothing is dropped (the cap is 5,000).
    const batch = h.db.batch.bind(h.db);
    h.db.batch = async () => {
      throw new Error('D1 is down');
    };
    for (let n = 1; n <= 300; n++) g.message(n + 1, n, hook);
    await settle();
    await clock.advance(500);
    expect(g.svc.snapshot()).toMatchObject({ buffered: 300, events_dropped: false });

    // Counts every D1 call the way the budget does: each statement of a batch separately.
    let queries = 0;
    const prepare = h.db.prepare.bind(h.db);
    h.db.prepare = (sql: string) => {
      const stmt = prepare(sql);
      const count =
        <T>(f: () => Promise<T>) =>
        () => {
          queries++;
          return f();
        };
      const wrap = (s: typeof stmt): typeof stmt => ({
        bind: (...v) => wrap(s.bind(...v)),
        first: <T>() => count(() => s.first<T>())(),
        all: <T>() => count(() => s.all<T>())(),
        run: count(() => s.run()),
        ...{ runSync: (s as any).runSync?.bind(s) },
      });
      return wrap(stmt);
    };
    h.db.batch = async (stmts) => {
      queries += stmts.length;
      return batch(stmts.map((s) => (s as any).raw ?? s));
    };
    const before = g.wakes.length;
    await clock.advance(5_000);
    await vi.waitFor(() => expect(g.wakes.length).toBeGreaterThan(before), { timeout: 10_000 });
    await settle();
    // Some rounds fit; the next might not, so the rest waits for a fresh invocation (the next alarm).
    const left = g.svc.snapshot().buffered as number;
    expect(left).toBeGreaterThan(0);
    expect(left).toBeLessThan(300);
    expect(queries).toBeLessThanOrEqual(QUERY_BUDGET + 350);
    expect(g.wakes.at(-1)! - clock.now()).toBeGreaterThan(0);
    expect(g.wakes.at(-1)! - clock.now()).toBeLessThanOrEqual(CONTINUE_MS);

    for (let i = 0; i < 10 && (g.svc.snapshot().buffered as number) > 0; i++) {
      queries = 0;
      await g.svc.tick();
      await vi.waitFor(async () => expect((await all(h, 'SELECT 1 FROM conversation')).length).toBeGreaterThan(300 - left), { timeout: 10_000 });
      await settle();
      expect(queries).toBeLessThanOrEqual(QUERY_BUDGET + 350);
    }
    expect(await all(h, 'SELECT 1 FROM conversation')).toHaveLength(300);
    expect(g.svc.snapshot().buffered).toBe(0);
    expect(g.storage.get('session')).toMatchObject({ seq: 301 });
  }, 30_000);
});

describe('two lost sessions close together', () => {
  it('keep the second gap’s cursor even though the first backfill run finishes after it', async () => {
    const { h } = await world();
    await moreChannels(h);
    // Both channels have been read before: the cursors say where.
    for (const [channel, last] of [
      [LOUNGE, msg(1)],
      [NEWS, msg(1)],
    ] as const)
      await h.db
        .prepare('INSERT INTO channel_cursors (channel_id, last_message_id, updated_at) VALUES (?, CAST(? AS INTEGER), ?)')
        .bind(channel, last, h.now().toISOString())
        .run();

    const clock = clockFor(h);
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => (release = resolve));
    const asked: string[] = [];
    h.setDiscord(async (req) => {
      const url = new URL(req.url);
      if (url.pathname.endsWith('/gateway/bot'))
        return Response.json({
          url: 'wss://gateway.discord.gg',
          shards: 1,
          session_start_limit: { total: 1000, remaining: 999, reset_after: 3_600_000, max_concurrency: 1 },
        });
      const m = /\/channels\/(\d+)\/messages$/.exec(url.pathname);
      if (!m) return Response.json({ message: 'Unknown Channel', code: 10003 }, { status: 404 });
      const after = url.searchParams.get('after');
      asked.push(`${m[1]} after=${after}`);
      const rest = (n: number) => ({ id: msg(n), channel_id: m[1], author: AUTHOR, content: `m ${n}`, timestamp: at(3, n), type: 0, edited_timestamp: null });
      // #lounge's cursor is at the live message (40) when the first session is lost.
      if (m[1] === LOUNGE) return Response.json(after === msg(40) ? [rest(50)] : after === msg(50) ? [rest(60)] : []);
      // The second channel's fetch hangs until the test lets go.
      await gate;
      return Response.json([]);
    });

    const g = service(h, clock);
    await g.svc.ensure();
    g.hello();
    g.ready(1, 'sess-1');
    g.message(2, 40);
    await clock.advance(500);

    // First lost session: #lounge is fetched at once, #news hangs mid-run.
    g.send({ op: 9, d: false });
    await clock.advance(5_000);
    g.hello();
    g.ready(1, 'sess-2');
    await vi.waitFor(async () => expect(await one(h, 'SELECT 1 AS found FROM conversation WHERE message_id = ?', msg(50))).not.toBeNull(), { timeout: 5_000 });
    expect(asked).toContain(`${NEWS} after=${msg(1)}`);

    // Second lost session while that run is still waiting on #news. #lounge was finished, then lost messages again.
    // (A session rejected again so soon is retried after a longer wait.)
    g.send({ op: 9, d: false });
    await clock.advance(15_000);
    g.hello();
    g.ready(1, 'sess-3');
    await settle();
    release();
    await vi.waitFor(() => expect(h.log.lines.filter((l) => l.event === 'gateway.backfill').length).toBeGreaterThanOrEqual(1), { timeout: 5_000 });

    // The run that was in flight ended with #lounge back in the stored cursors, so the next run fetches what was lost.
    for (let i = 0; i < 5 && g.svc.snapshot().backfill_pending; i++) {
      await g.svc.tick();
      await settle();
    }
    await vi.waitFor(async () => expect(await one(h, 'SELECT 1 AS found FROM conversation WHERE message_id = ?', msg(60))).not.toBeNull(), { timeout: 5_000 });
    expect(asked).toContain(`${LOUNGE} after=${msg(50)}`);
    expect(g.svc.snapshot().backfill_pending).toBe(false);
  }, 30_000);
});

describe('looking for places new to the relay', () => {
  it('happens at most every SEED_CHECK_MS unless a channel or thread appears', async () => {
    const { h } = await world();
    const clock = clockFor(h);
    discord(h);
    let looks = 0;
    const prepare = h.db.prepare.bind(h.db);
    h.db.prepare = (sql: string) => {
      if (sql.includes('UNION ALL') && sql.includes('channel_cursors')) looks++;
      return prepare(sql);
    };
    const g = service(h, clock);
    await g.svc.ensure();
    await settle();
    expect(looks).toBe(1);
    for (let i = 0; i < 3; i++) {
      await clock.advance(WAKE_MS);
      await g.svc.ensure();
      await settle();
    }
    expect(looks).toBe(1);

    // Discord announces a channel: the next ensure looks.
    g.hello();
    g.ready(1);
    g.dispatch('CHANNEL_CREATE', 2, { id: '110000000000000099', guild_id: GUILD_ID, name: 'new', type: 0 });
    await clock.advance(500);
    await g.svc.ensure();
    await settle();
    expect(looks).toBe(2);

    await clock.advance(SEED_CHECK_MS);
    await g.svc.ensure();
    await settle();
    expect(looks).toBe(3);
  });
});

describe('a failed first load', () => {
  it('is not remembered: the next call loads again', async () => {
    const { h } = await world();
    const clock = clockFor(h);
    discord(h);
    const prepare = h.db.prepare.bind(h.db);
    let fail = true;
    h.db.prepare = (sql: string) => {
      if (fail && sql === 'SELECT id FROM channels') {
        fail = false;
        throw new Error('D1 hiccup');
      }
      return prepare(sql);
    };
    const g = service(h, clock);
    await expect(g.svc.ensure()).rejects.toThrow('D1 hiccup');
    await g.svc.ensure();
    expect(g.connections).toHaveLength(1);
  });
});
