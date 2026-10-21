import type { Relay } from '@logitland/relay';
import { GUILD, LOUNGE, harness, seedChannel } from '@logitland/relay/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DiscordGateway, gatewayClient } from './gateway';
import type { Bindings } from './index';

// The Durable Object is a thin shell (socket, timers, storage, alarm); the Gateway logic is tested in
// packages/relay. These tests drive the shell with a stand-in for the Workers WebSocket and DO storage.

class FakeWs {
  listeners: Record<string, ((event: any) => void)[]> = {};
  sent: any[] = [];
  accepted = false;
  closed: [number, string] | null = null;
  accept() {
    this.accepted = true;
  }
  addEventListener(type: string, fn: (event: any) => void) {
    (this.listeners[type] ??= []).push(fn);
  }
  send(data: string) {
    this.sent.push(JSON.parse(data));
  }
  close(code: number, reason: string) {
    this.closed = [code, reason];
  }
  emit(type: string, event: object) {
    for (const fn of this.listeners[type] ?? []) fn(event);
  }
  frame(frame: object) {
    this.emit('message', { data: JSON.stringify(frame) });
  }
}

function storageStand(initial = new Map<string, unknown>()) {
  const alarms: number[] = [];
  return {
    data: initial,
    alarms,
    storage: {
      get: async (key: string) => initial.get(key),
      put: async (key: string, value: unknown) => void initial.set(key, structuredClone(value)),
      delete: async (key: string) => initial.delete(key),
      setAlarm: async (at: number) => void alarms.push(at),
    },
  };
}

const env = (over: Partial<Bindings> = {}) => ({ DISCORD_BOT_TOKEN: 'bot-token', ...over }) as unknown as Bindings;

function discordRest(h: ReturnType<typeof harness>) {
  h.setDiscord(async (req) => {
    if (new URL(req.url).pathname.endsWith('/gateway/bot'))
      return Response.json({
        url: 'wss://gateway.discord.gg',
        shards: 1,
        session_start_limit: { total: 1000, remaining: 999, reset_after: 3_600_000, max_concurrency: 1 },
      });
    return Response.json([]);
  });
}

/** The real Durable Object, with its relay supplied by the test harness. */
class Subject extends DiscordGateway {
  constructor(
    ctx: ReturnType<typeof storageStand>,
    environment: Bindings,
    private readonly relay: Relay,
  ) {
    super(ctx as never, environment);
  }
  protected override buildRelay() {
    return this.relay;
  }
  /** Stops the timers a test would otherwise leave running into the next one. */
  close() {
    this.gateway().shutdown();
  }
}

const open: Subject[] = [];
const subject = (state: ReturnType<typeof storageStand>, environment: Bindings, relay: Relay) => {
  const s = new Subject(state, environment, relay);
  open.push(s);
  return s;
};

function stubSockets() {
  const sockets: FakeWs[] = [];
  const requests: { url: string; headers: Record<string, string> }[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: RequestInit) => {
      requests.push({ url, headers: init.headers as Record<string, string> });
      const ws = new FakeWs();
      sockets.push(ws);
      return { status: 101, webSocket: ws } as unknown as Response;
    }),
  );
  return { sockets, requests };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 40));

afterEach(() => {
  for (const s of open.splice(0)) s.close();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('DiscordGateway', () => {
  beforeEach(() => {
    // The first reconnect waits a random time under a second; pin it so a test can look at the state in between.
    vi.spyOn(Math, 'random').mockReturnValue(0.9);
  });

  it('opens an outbound WebSocket to the https form of the Gateway URL and identifies', async () => {
    const h = harness();
    discordRest(h);
    const { sockets, requests } = stubSockets();
    const state = storageStand();
    const gateway = subject(state, env(), h.relay);
    await gateway.ensure();

    expect(requests).toEqual([{ url: 'https://gateway.discord.gg/?v=10&encoding=json', headers: { Upgrade: 'websocket' } }]);
    expect(sockets[0]!.accepted).toBe(true);
    sockets[0]!.frame({ op: 10, d: { heartbeat_interval: 41_250 } });
    expect(sockets[0]!.sent[0]).toMatchObject({ op: 2, d: { token: 'bot-token', intents: 1 | 512 | 1024 | 32768 } });
    sockets[0]!.frame({ op: 0, t: 'READY', s: 1, d: { session_id: 'sess-1', resume_gateway_url: 'wss://resume.discord.gg' } });
    await settle();
    expect(await gateway.status()).toMatchObject({ status: 'connected', resumable: true });
    expect(state.data.get('session')).toEqual({ sessionId: 'sess-1', resumeUrl: 'wss://resume.discord.gg', seq: 1 });
    // The alarm is armed, shorter than one heartbeat interval.
    expect(state.alarms.at(-1)! - Date.now()).toBeLessThanOrEqual(30_000);
    expect(state.alarms.at(-1)! - Date.now()).toBeGreaterThan(0);
  });

  it('records a message, and keeps only what it has safely stored as the place to resume from', async () => {
    const h = harness();
    await seedChannel(h.relay, { id: LOUNGE, access: 'post' });
    discordRest(h);
    const { sockets } = stubSockets();
    const state = storageStand();
    const gateway = subject(state, env(), h.relay);
    await gateway.ensure();
    sockets[0]!.frame({ op: 10, d: { heartbeat_interval: 41_250 } });
    sockets[0]!.frame({ op: 0, t: 'READY', s: 1, d: { session_id: 'sess-1', resume_gateway_url: 'wss://resume.discord.gg' } });
    sockets[0]!.frame({
      op: 0,
      t: 'MESSAGE_CREATE',
      s: 2,
      d: {
        id: '300000000000000001',
        channel_id: LOUNGE,
        guild_id: GUILD,
        author: { id: '200000000000000001', username: 'newsbot', bot: true },
        content: 'hello',
        timestamp: '2026-10-19T03:00:01.000000+00:00',
        type: 0,
      },
    });
    await vi.waitFor(async () => expect(await h.db.prepare('SELECT COUNT(*) AS n FROM conversation').first()).toEqual({ n: 1 }), { timeout: 3_000 });
    await vi.waitFor(() => expect(state.data.get('session')).toMatchObject({ seq: 2 }), { timeout: 3_000 });
  });

  it('resumes after an eviction: the alarm wakes a new instance, which resumes the stored session', async () => {
    const h = harness();
    discordRest(h);
    const { sockets, requests } = stubSockets();
    const state = storageStand(new Map<string, unknown>([['session', { sessionId: 'sess-1', resumeUrl: 'wss://resume.discord.gg', seq: 41 }]]));
    const woken = subject(state, env(), h.relay);
    await woken.alarm();
    expect(requests[0]!.url).toBe('https://resume.discord.gg/?v=10&encoding=json');
    sockets[0]!.frame({ op: 10, d: { heartbeat_interval: 41_250 } });
    expect(sockets[0]!.sent).toEqual([{ op: 6, d: { token: 'bot-token', session_id: 'sess-1', seq: 41 } }]);
    sockets[0]!.frame({ op: 0, t: 'RESUMED', s: 42, d: {} });
    await settle();
    expect(await woken.status()).toMatchObject({ status: 'connected' });
    // It armed its next wake-up too.
    expect(state.alarms).toHaveLength(1);
  });

  it('reports a fatal close in plain words and stays down until the retry time', async () => {
    const h = harness();
    discordRest(h);
    const { sockets } = stubSockets();
    const state = storageStand();
    const gateway = subject(state, env(), h.relay);
    await gateway.ensure();
    sockets[0]!.frame({ op: 10, d: { heartbeat_interval: 41_250 } });
    sockets[0]!.emit('close', { code: 4014, reason: 'Disallowed intent(s)' });
    await settle();
    const status = (await gateway.status()).status as string;
    expect(status).toBe('stopped: enable the Message Content intent in the Developer Portal (Bot, Privileged Gateway Intents)');
    expect(await h.db.prepare("SELECT status FROM intake_state WHERE source = 'gateway'").first()).toEqual({ status });
    await gateway.ensure();
    expect(sockets).toHaveLength(1);
    // The next wake-up is the retry, ten minutes after the stop.
    expect(state.alarms.at(-1)! - Date.now()).toBeGreaterThan(9 * 60_000);
  });

  it('survives Discord refusing the upgrade, and tries again', async () => {
    const h = harness();
    discordRest(h);
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ status: 503, webSocket: null }) as unknown as Response),
    );
    const gateway = subject(storageStand(), env(), h.relay);
    await expect(gateway.ensure()).resolves.toBeUndefined();
    expect(await gateway.status()).toMatchObject({ status: 'reconnecting', last_error: 'Discord did not accept the WebSocket upgrade (HTTP 503)' });
  });

  it('says what is wrong when there is no bot token', async () => {
    const h = harness();
    const { requests } = stubSockets();
    const gateway = subject(storageStand(), env({ DISCORD_BOT_TOKEN: undefined }), h.relay);
    await gateway.ensure();
    expect(requests).toHaveLength(0);
    expect((await gateway.status()).status).toBe('stopped: DISCORD_BOT_TOKEN is not set, so the relay can’t read the Discord server');
  });

  it('treats a socket error as a dropped connection', async () => {
    const h = harness();
    discordRest(h);
    const { sockets } = stubSockets();
    const gateway = subject(storageStand(), env(), h.relay);
    await gateway.ensure();
    sockets[0]!.frame({ op: 10, d: { heartbeat_interval: 41_250 } });
    sockets[0]!.emit('error', {});
    await settle();
    expect((await gateway.status()).status).toBe('reconnecting');
  });
});

describe('gatewayClient', () => {
  it('talks to the one instance named discord', async () => {
    const calls: string[] = [];
    const stub = { ensure: async () => void calls.push('ensure'), status: async () => ({ status: 'connected' }) };
    const ns = { idFromName: (name: string) => (calls.push(`id:${name}`), name), get: () => stub } as unknown as DurableObjectNamespace<DiscordGateway>;
    const client = gatewayClient(ns);
    await client.ensure();
    expect(await client.status()).toEqual({ status: 'connected' });
    expect(calls).toEqual(['id:discord', 'ensure', 'id:discord']);
  });
});
