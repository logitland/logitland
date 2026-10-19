import { describe, expect, it } from 'vitest';
import {
  GatewayConnection,
  GatewayStopError,
  IdentifyLimitError,
  INTENTS,
  INVALID_BACKOFF_MAX_MS,
  NO_SESSION,
  classifyClose,
  type GatewayDeps,
  type GatewaySession,
  type GatewaySocket,
  type SocketEvents,
} from './gateway';

class FakeSocket implements GatewaySocket {
  sent: { op: number; d: any }[] = [];
  closed: { code: number; reason: string } | null = null;
  send(data: string) {
    this.sent.push(JSON.parse(data));
  }
  close(code: number, reason: string) {
    this.closed = { code, reason };
  }
}

const settle = () => new Promise((resolve) => setImmediate(resolve));

function rig({ random = 0.5, ...over }: Omit<Partial<GatewayDeps>, 'random'> & { random?: number } = {}) {
  let now = 0;
  let timers: { at: number; fn: () => void; live: boolean }[] = [];
  const connections: { url: string; socket: FakeSocket; events: SocketEvents }[] = [];
  const statuses: string[] = [];
  const dispatched: { t: string; d: unknown; s: number }[] = [];
  const sessions: { session: GatewaySession; why: string }[] = [];
  const ready: boolean[] = [];
  const state = { random, connectError: null as Error | null, urls: 0 };
  const conn = new GatewayConnection({
    token: 'bot-token',
    gatewayUrl: async () => {
      state.urls++;
      return 'wss://gateway.discord.gg';
    },
    connect: async (url, events) => {
      if (state.connectError) throw state.connectError;
      const socket = new FakeSocket();
      connections.push({ url, socket, events });
      return socket;
    },
    setTimer: (fn, ms) => {
      const t = { at: now + ms, fn, live: true };
      timers.push(t);
      return () => {
        t.live = false;
      };
    },
    now: () => now,
    random: () => state.random,
    onDispatch: (t, d, s) => dispatched.push({ t, d, s }),
    onStatus: (status) => statuses.push(status),
    onSession: (session, why) => sessions.push({ session, why }),
    onReady: ({ resumed }) => ready.push(resumed),
    ...over,
  });
  const advance = async (ms: number) => {
    const target = now + ms;
    for (;;) {
      const next = timers.filter((t) => t.live && t.at <= target).sort((a, b) => a.at - b.at)[0];
      if (!next) break;
      now = next.at;
      next.live = false;
      next.fn();
      await settle();
    }
    now = target;
    timers = timers.filter((t) => t.live);
  };
  const deliver = (i: number, frame: object) => connections[i]!.events.message(JSON.stringify(frame));
  const hello = (i = connections.length - 1, interval = 40_000) => deliver(i, { op: 10, d: { heartbeat_interval: interval } });
  const dispatch = (i: number, t: string, s: number, d: object = {}) => deliver(i, { op: 0, t, s, d });
  const readyFrame = (i: number, s = 1) => dispatch(i, 'READY', s, { session_id: 'sess-1', resume_gateway_url: 'wss://resume.discord.gg' });
  const last = () => connections[connections.length - 1]!;
  return { conn, connections, statuses, dispatched, sessions, ready, state, advance, deliver, hello, dispatch, readyFrame, last, settle, now: () => now };
}

const resumable: GatewaySession = { sessionId: 'sess-1', resumeUrl: 'wss://resume.discord.gg', seq: 7 };

describe('connecting', () => {
  it('opens a JSON v10 connection, jitters the first heartbeat and identifies with the three intents', async () => {
    const r = rig({ random: 0.25 });
    await r.conn.start();
    expect(r.last().url).toBe('wss://gateway.discord.gg/?v=10&encoding=json');
    expect(r.statuses).toEqual(['connecting']);

    r.hello();
    expect(r.last().socket.sent).toEqual([
      { op: 2, d: { token: 'bot-token', intents: INTENTS, properties: { os: 'linux', browser: 'logitland', device: 'logitland' } } },
    ]);
    expect(INTENTS).toBe(1 | 512 | 32768);

    await r.advance(9_999);
    expect(r.last().socket.sent).toHaveLength(1);
    await r.advance(1);
    expect(r.last().socket.sent[1]).toEqual({ op: 1, d: null });
  });

  it('keeps the session from READY and reports connected', async () => {
    const r = rig();
    await r.conn.start();
    r.hello();
    r.readyFrame(0);
    expect(r.statuses.at(-1)).toBe('connected');
    expect(r.ready).toEqual([false]);
    expect(r.sessions).toEqual([{ session: { sessionId: 'sess-1', resumeUrl: 'wss://resume.discord.gg', seq: 1 }, why: 'ready' }]);
    expect(r.conn.state).toBe('ready');
  });

  it('beats every interval with the last sequence number and passes other dispatches through in order', async () => {
    const r = rig({ random: 0 });
    await r.conn.start();
    r.hello();
    r.readyFrame(0);
    r.dispatch(0, 'MESSAGE_CREATE', 2, { id: 'a' });
    r.dispatch(0, 'MESSAGE_CREATE', 3, { id: 'b' });
    expect(r.dispatched.map((d) => [d.t, d.s])).toEqual([
      ['MESSAGE_CREATE', 2],
      ['MESSAGE_CREATE', 3],
    ]);
    await r.advance(0);
    expect(r.last().socket.sent.at(-1)).toEqual({ op: 1, d: 3 });
    r.deliver(0, { op: 11 });
    await r.advance(40_000);
    expect(r.last().socket.sent.filter((f) => f.op === 1)).toHaveLength(2);
  });

  it('answers a heartbeat request at once', async () => {
    const r = rig();
    await r.conn.start();
    r.hello();
    r.readyFrame(0, 4);
    r.deliver(0, { op: 1, d: null });
    expect(r.last().socket.sent.at(-1)).toEqual({ op: 1, d: 4 });
  });
});

describe('resuming', () => {
  it('sends RESUME to the stored resume URL when a session, sequence and URL exist', async () => {
    const r = rig();
    r.conn.restore(resumable);
    await r.conn.start();
    expect(r.last().url).toBe('wss://resume.discord.gg/?v=10&encoding=json');
    expect(r.statuses[0]).toBe('resuming');
    r.hello();
    expect(r.last().socket.sent).toEqual([{ op: 6, d: { token: 'bot-token', session_id: 'sess-1', seq: 7 } }]);
    r.dispatch(0, 'RESUMED', 8);
    expect(r.statuses.at(-1)).toBe('connected');
    expect(r.ready).toEqual([true]);
    // The replayed events that follow carry on from the stored sequence.
    r.dispatch(0, 'MESSAGE_CREATE', 9);
    expect(r.conn.current.seq).toBe(9);
  });

  it('identifies instead when a piece of the session is missing', async () => {
    const r = rig();
    r.conn.restore({ sessionId: 'sess-1', resumeUrl: 'wss://resume.discord.gg', seq: null });
    await r.conn.start();
    expect(r.last().url).toContain('gateway.discord.gg');
    r.hello();
    expect(r.last().socket.sent[0]!.op).toBe(2);
  });

  it('detects a zombie connection (no ACK before the next beat), drops it with a resumable code and resumes', async () => {
    const r = rig({ random: 0 });
    await r.conn.start();
    r.hello();
    r.readyFrame(0, 5);
    await r.advance(0); // first beat
    await r.advance(40_000); // no ACK arrived: this beat finds a zombie
    expect(r.connections[0]!.socket.closed).toEqual({ code: 4000, reason: 'reconnecting' });
    expect(r.statuses.slice(-2)).toEqual(['reconnecting', 'resuming']);
    expect(r.connections).toHaveLength(2);
    expect(r.connections[1]!.url).toBe('wss://resume.discord.gg/?v=10&encoding=json');
    r.hello(1);
    expect(r.connections[1]!.socket.sent[0]).toEqual({ op: 6, d: { token: 'bot-token', session_id: 'sess-1', seq: 5 } });
    // Whatever the dead socket still says is ignored.
    r.dispatch(0, 'MESSAGE_CREATE', 6);
    expect(r.dispatched).toHaveLength(0);
  });

  it('does not call a connection a zombie while ACKs keep arriving', async () => {
    const r = rig({ random: 0 });
    await r.conn.start();
    r.hello();
    r.readyFrame(0);
    for (let i = 0; i < 4; i++) {
      await r.advance(i === 0 ? 0 : 40_000);
      r.deliver(0, { op: 11 });
    }
    expect(r.connections).toHaveLength(1);
    expect(r.connections[0]!.socket.closed).toBeNull();
  });

  it('reconnects and resumes straight away when Discord asks', async () => {
    const r = rig();
    await r.conn.start();
    r.hello();
    r.readyFrame(0, 3);
    r.deliver(0, { op: 7, d: null });
    expect(r.connections[0]!.socket.closed?.code).toBe(4000);
    await r.advance(0);
    expect(r.connections[1]!.url).toContain('resume.discord.gg');
    r.hello(1);
    expect(r.connections[1]!.socket.sent[0]).toMatchObject({ op: 6, d: { seq: 3 } });
  });
});

describe('invalid session', () => {
  async function resuming() {
    const r = rig({ random: 0.5 });
    r.conn.restore(resumable);
    await r.conn.start();
    r.hello();
    return r;
  }

  it('after a rejected resume that may be retried, waits 1 to 5 seconds and resumes once more on the same connection', async () => {
    const r = await resuming();
    r.deliver(0, { op: 9, d: true });
    await r.advance(2_999);
    expect(r.last().socket.sent).toHaveLength(1);
    await r.advance(1);
    expect(r.last().socket.sent).toHaveLength(2);
    expect(r.last().socket.sent[1]!.op).toBe(6);
    expect(r.connections).toHaveLength(1);
    // A second rejection gives the session up.
    r.deliver(0, { op: 9, d: true });
    expect(r.sessions.at(-1)).toEqual({ session: NO_SESSION, why: 'lost' });
  });

  it('when the session is dead, forgets it, waits, and identifies on a fresh connection', async () => {
    const r = await resuming();
    r.deliver(0, { op: 9, d: false });
    expect(r.sessions).toEqual([{ session: NO_SESSION, why: 'lost' }]);
    await r.advance(2_999);
    expect(r.connections).toHaveLength(1);
    await r.advance(1);
    await r.advance(0);
    expect(r.connections).toHaveLength(2);
    expect(r.connections[1]!.url).toContain('gateway.discord.gg');
    r.hello(1);
    expect(r.connections[1]!.socket.sent[0]!.op).toBe(2);
  });

  it('waits a random time between 1 and 5 seconds', async () => {
    for (const [random, ms] of [
      [0, 1000],
      [1, 5000],
    ] as const) {
      const r = rig({ random });
      r.conn.restore(resumable);
      await r.conn.start();
      r.hello();
      const before = r.connections.length;
      r.deliver(0, { op: 9, d: false });
      await r.advance(ms - 1);
      expect(r.connections).toHaveLength(before);
      await r.advance(1);
      await r.advance(1000);
      expect(r.connections.length).toBeGreaterThan(before);
    }
  });

  it('resumes on a fresh connection when an established session is invalidated but may be resumed', async () => {
    const r = rig();
    await r.conn.start();
    r.hello();
    r.readyFrame(0, 6);
    r.deliver(0, { op: 9, d: true });
    expect(r.sessions).toHaveLength(1);
    await r.advance(3_000);
    await r.advance(0);
    expect(r.connections).toHaveLength(2);
    expect(r.connections[1]!.url).toContain('resume.discord.gg');
    r.hello(1);
    expect(r.connections[1]!.socket.sent[0]).toMatchObject({ op: 6, d: { seq: 6 } });
  });

  it('retries an IDENTIFY that was rejected for a reason that will pass', async () => {
    const r = rig();
    await r.conn.start();
    r.hello();
    r.deliver(0, { op: 9, d: true });
    await r.advance(3_000);
    await r.advance(0);
    expect(r.connections).toHaveLength(2);
    r.hello(1);
    expect(r.connections[1]!.socket.sent[0]!.op).toBe(2);
  });
});

describe('close codes', () => {
  it.each([
    [4000, 'resume'],
    [4001, 'resume'],
    [4002, 'resume'],
    [4005, 'resume'],
    [4008, 'resume'],
    [1006, 'resume'],
    [1001, 'resume'],
    [4003, 'identify'],
    [4007, 'identify'],
    [4009, 'identify'],
  ] as const)('%i → %s', (code, action) => {
    expect(classifyClose(code)).toEqual({ action });
  });

  it.each([4004, 4010, 4011, 4012, 4013, 4014])('%i is fatal', (code) => {
    expect(classifyClose(code).action).toBe('stop');
  });

  it('resumes after a code that allows it', async () => {
    const r = rig();
    await r.conn.start();
    r.hello();
    r.readyFrame(0, 9);
    r.connections[0]!.events.close(4008, 'slow down');
    expect(r.statuses.at(-1)).toBe('reconnecting');
    await r.advance(1000);
    expect(r.connections[1]!.url).toContain('resume.discord.gg');
  });

  it('starts a new session after a code that ends it', async () => {
    const r = rig();
    await r.conn.start();
    r.hello();
    r.readyFrame(0, 9);
    r.connections[0]!.events.close(4009, 'timed out');
    expect(r.sessions.at(-1)).toEqual({ session: NO_SESSION, why: 'lost' });
    await r.advance(1000);
    expect(r.connections[1]!.url).toContain('gateway.discord.gg');
    r.hello(1);
    expect(r.connections[1]!.socket.sent[0]!.op).toBe(2);
  });

  it('stops for good when the intent is not enabled, says how to fix it, and does not reconnect', async () => {
    const r = rig();
    await r.conn.start();
    r.hello();
    r.connections[0]!.events.close(4014, 'Disallowed intent(s)');
    expect(r.statuses.at(-1)).toBe('stopped: enable the Message Content intent in the Developer Portal (Bot, Privileged Gateway Intents)');
    expect(r.conn.state).toBe('stopped');
    expect(r.conn.stopStatus).toContain('Message Content intent');
    await r.advance(10 * 60_000);
    expect(r.connections).toHaveLength(1);
  });

  it('stops on a bad token, and can be started again later', async () => {
    const r = rig();
    await r.conn.start();
    r.hello();
    r.connections[0]!.events.close(4004, 'Authentication failed');
    expect(r.statuses.at(-1)).toContain('Discord rejected the bot token');
    await r.advance(60_000);
    expect(r.connections).toHaveLength(1);
    await r.conn.start();
    expect(r.connections).toHaveLength(2);
    expect(r.conn.stopStatus).toBeNull();
  });
});

describe('failing to connect', () => {
  it('backs off with growing delays and recovers', async () => {
    const r = rig({ random: 1 });
    r.state.connectError = new Error('network down');
    await r.conn.start();
    expect(r.statuses.at(-1)).toBe('reconnecting');
    // With the largest jitter: 1 s, then 1 s, 2 s, 4 s …
    for (const [wait, attempts] of [
      [999, 1],
      [1, 2],
      [999, 2],
      [1, 3],
      [1_999, 3],
      [1, 4],
    ] as const) {
      await r.advance(wait);
      expect(r.state.urls).toBe(attempts);
    }
    r.state.connectError = null;
    await r.advance(4_000);
    expect(r.connections).toHaveLength(1);
  });

  it('gives up on a connection that never says hello', async () => {
    const r = rig();
    await r.conn.start();
    await r.advance(20_000);
    expect(r.connections[0]!.socket.closed?.code).toBe(4000);
    expect(r.statuses.at(-1)).toBe('reconnecting');
    await r.advance(1000);
    expect(r.connections).toHaveLength(2);
  });

  it('gives up on a socket that never opens, and closes it if it opens late', async () => {
    let open!: (s: FakeSocket) => void;
    const late = new FakeSocket();
    const r = rig({ connect: () => new Promise<GatewaySocket>((resolve) => (open = resolve as (s: FakeSocket) => void)) });
    const started = r.conn.start();
    await r.settle();
    await r.advance(20_000);
    await started;
    expect(r.statuses.at(-1)).toBe('reconnecting');
    open(late);
    await r.settle();
    expect(late.closed?.code).toBe(4000);
  });

  it('waits out Discord’s limit on new sessions instead of retrying', async () => {
    const r = rig({
      gatewayUrl: async () => {
        throw new IdentifyLimitError(30 * 60_000);
      },
    });
    await r.conn.start();
    expect(r.statuses.at(-1)).toBe('waiting: Discord’s limit on new sessions is used up, trying again in 30 min');
    await r.conn.start();
    expect(r.connections).toHaveLength(0);
  });

  it('stops when told nothing can help', async () => {
    const r = rig({
      gatewayUrl: async () => {
        throw new GatewayStopError('stopped: Discord rejected the bot token. Check DISCORD_BOT_TOKEN');
      },
    });
    await r.conn.start();
    expect(r.conn.state).toBe('stopped');
    await r.advance(120_000);
    expect(r.state.urls).toBe(0);
  });
});

describe('shutdown', () => {
  it('closes with a code that keeps the session resumable', async () => {
    const r = rig();
    await r.conn.start();
    r.hello();
    r.readyFrame(0);
    r.conn.shutdown();
    expect(r.connections[0]!.socket.closed?.code).toBe(4000);
    expect(r.conn.state).toBe('idle');
    expect(r.conn.current.sessionId).toBe('sess-1');
  });
});

describe('reconnecting on a schedule', () => {
  it('does not skip a pending backoff when cron or the alarm calls start', async () => {
    const r = rig({ random: 1 });
    r.state.connectError = new Error('network down');
    await r.conn.start();
    await r.advance(1_000);
    await r.advance(1_000);
    // Three attempts so far; the next is due in 2 s.
    expect(r.state.urls).toBe(3);
    await r.conn.start();
    await r.conn.start();
    expect(r.state.urls).toBe(3);
    await r.advance(1_999);
    expect(r.state.urls).toBe(3);
    await r.advance(1);
    expect(r.state.urls).toBe(4);
    // Once the wait is over, a start with nothing pending connects at once.
    r.state.connectError = null;
    await r.advance(10_000);
    await r.conn.start();
    expect(r.connections).toHaveLength(1);
  });

  it('starts at once after reconnect() asks for it', async () => {
    const r = rig();
    await r.conn.start();
    r.hello();
    r.readyFrame(0);
    r.conn.reconnect('quiet');
    await r.conn.start();
    expect(r.connections).toHaveLength(2);
  });
});

describe('a session that keeps being rejected', () => {
  /** Rejects the IDENTIFY n times in a row and says how long each wait for the next connection was. */
  async function rejections(r: ReturnType<typeof rig>, n: number) {
    const waits: number[] = [];
    for (let i = 0; i < n; i++) {
      r.hello();
      const before = r.connections.length;
      const t0 = r.now();
      r.deliver(before - 1, { op: 9, d: false });
      while (r.connections.length === before) await r.advance(500);
      waits.push(r.now() - t0);
    }
    return waits;
  }

  it('waits longer each time, up to a cap, so it cannot spend the 1000 IDENTIFYs Discord allows a day', async () => {
    const r = rig({ random: 0.5 });
    await r.conn.start();
    const waits = await rejections(r, 10);
    // The first rejection is retried after the usual 1 to 5 seconds.
    expect(waits[0]).toBeLessThanOrEqual(5_000);
    for (let i = 1; i < 8; i++) expect(waits[i]!).toBeGreaterThan(waits[i - 1]!);
    expect(waits[1]!).toBeGreaterThanOrEqual(5_000);
    expect(Math.max(...waits)).toBeLessThanOrEqual(INVALID_BACKOFF_MAX_MS + 5_000);
    // At the cap it stays there: about 290 attempts a day at most.
    expect(waits[9]!).toBeGreaterThan(INVALID_BACKOFF_MAX_MS / 2);
  }, 30_000);

  it('starts over after a connection that held for a few minutes', async () => {
    const r = rig({ random: 0.5 });
    await r.conn.start();
    expect((await rejections(r, 3)).at(-1)!).toBeGreaterThan(8_000);
    // A long heartbeat interval keeps the zombie check out of the way of the six minutes.
    r.hello(r.connections.length - 1, 1_000_000_000);
    r.readyFrame(r.connections.length - 1);
    await r.advance(6 * 60_000);
    const before = r.connections.length;
    const t0 = r.now();
    r.deliver(before - 1, { op: 9, d: false });
    while (r.connections.length === before) await r.advance(500);
    expect(r.now() - t0).toBeLessThanOrEqual(5_000);
  }, 30_000);
});
