// Discord Gateway v10 (JSON, uncompressed) as a state machine that owns neither the socket nor the clock.
// The caller supplies both, so the same code runs in the Durable Object and in Node tests.
// https://docs.discord.com/developers/events/gateway
// https://docs.discord.com/developers/topics/opcodes-and-status-codes

export const GATEWAY_VERSION = 10;

export const Op = { Dispatch: 0, Heartbeat: 1, Identify: 2, Resume: 6, Reconnect: 7, InvalidSession: 9, Hello: 10, HeartbeatAck: 11 } as const;

export const Intents = { Guilds: 1 << 0, GuildMessages: 1 << 9, MessageContent: 1 << 15 } as const;
export const INTENTS = Intents.Guilds | Intents.GuildMessages | Intents.MessageContent;

/** How long to wait for HELLO after the socket opens before trying again. */
export const HELLO_TIMEOUT_MS = 20_000;

export type CloseAction = { action: 'resume' } | { action: 'identify' } | { action: 'stop'; status: string };

// Codes whose documented meaning is "don't reconnect": the settings are wrong, so retrying can't help.
const FATAL: Record<number, string> = {
  4004: 'stopped: Discord rejected the bot token. Check DISCORD_BOT_TOKEN',
  4010: 'stopped: Discord rejected the shard settings',
  4011: 'stopped: the bot is in too many servers for one connection and needs sharding',
  4012: 'stopped: Discord rejected the Gateway version',
  4013: 'stopped: Discord rejected the intents the relay asked for',
  4014: 'stopped: enable the Message Content intent in the Developer Portal (Bot, Privileged Gateway Intents)',
};

// The session is gone: 4003 says it was invalidated, 4007 and 4009 say to start a new one.
const FRESH_SESSION = new Set([4003, 4007, 4009]);

/** What to do after Discord (or the network) closes the socket with this code. Everything else may resume. */
export function classifyClose(code: number): CloseAction {
  const status = FATAL[code];
  if (status) return { action: 'stop', status };
  return { action: FRESH_SESSION.has(code) ? 'identify' : 'resume' };
}

export interface GatewaySession {
  sessionId: string | null;
  resumeUrl: string | null;
  /** The last sequence number received (or, after a restart, the last one the relay stored safely). */
  seq: number | null;
}

export const NO_SESSION: GatewaySession = { sessionId: null, resumeUrl: null, seq: null };

export interface GatewaySocket {
  send(data: string): void;
  close(code: number, reason: string): void;
}

export interface SocketEvents {
  message(data: string | ArrayBuffer): void;
  close(code: number, reason: string): void;
}

/** Thrown by `gatewayUrl` when nothing can help: the connection stops and the message becomes the status. */
export class GatewayStopError extends Error {
  constructor(status: string) {
    super(status);
    this.name = 'GatewayStopError';
  }
}

/** Thrown by `gatewayUrl` when Discord's limit on new sessions is used up. The connection waits instead of retrying. */
export class IdentifyLimitError extends Error {
  constructor(readonly retryAfterMs: number) {
    super('Discord’s limit on new Gateway sessions is used up');
    this.name = 'IdentifyLimitError';
  }
}

export interface GatewayDeps {
  token: string;
  /** A fresh Gateway URL, for connecting without a session. */
  gatewayUrl(): Promise<string>;
  /** Opens the socket; it is open when the promise resolves. Frames and closes go to `events`. */
  connect(url: string, events: SocketEvents): Promise<GatewaySocket>;
  setTimer(fn: () => void, ms: number): () => void;
  now(): number;
  random(): number;
  /** Every dispatch except READY and RESUMED, in order. */
  onDispatch(t: string, d: unknown, s: number): void;
  /** Plain words for the admin health page: connecting, connected, resuming, reconnecting, waiting: …, stopped: … */
  onStatus(status: string, error?: string): void;
  /** READY (session set) or a lost session (session empty). */
  onSession?(session: GatewaySession, why: 'ready' | 'lost'): void;
  onReady?(info: { resumed: boolean }): void;
  onHeartbeat?(): void;
  log?(event: string, fields?: Record<string, unknown>): void;
}

type Phase = 'idle' | 'opening' | 'hello' | 'identifying' | 'resuming' | 'ready' | 'waiting' | 'stopped';
type TimerName = 'beat' | 'hello' | 'retry' | 'invalid';

const decoder = new TextDecoder();

function withParams(url: string): string {
  const u = new URL(url);
  u.searchParams.set('v', String(GATEWAY_VERSION));
  u.searchParams.set('encoding', 'json');
  return u.toString();
}

export class GatewayConnection {
  private phase: Phase = 'idle';
  private session: GatewaySession = NO_SESSION;
  private socket: GatewaySocket | null = null;
  /** Bumped whenever a socket is abandoned, so anything it still says is ignored. */
  private gen = 0;
  private interval = 0;
  private acked = true;
  private sent: 'identify' | 'resume' | null = null;
  private resuming = false;
  private attempts = 0;
  private resumeRejections = 0;
  private notBefore = 0;
  private lastFrame = 0;
  private timers: Partial<Record<TimerName, () => void>> = {};
  private stopped: string | null = null;

  constructor(private readonly deps: GatewayDeps) {}

  get state(): Phase {
    return this.phase;
  }

  get current(): GatewaySession {
    return { ...this.session };
  }

  /** When the last frame arrived (the deps' clock), for liveness checks. */
  get lastFrameAt(): number {
    return this.lastFrame;
  }

  get heartbeatMs(): number {
    return this.interval;
  }

  get stopStatus(): string | null {
    return this.stopped;
  }

  /** Loads a session kept from before a restart. */
  restore(session: GatewaySession): void {
    this.session = { ...session };
  }

  /** Connects if not connected. Resolves once the attempt has been made, not when the session is ready. */
  async start(): Promise<void> {
    if (this.phase !== 'idle' && this.phase !== 'waiting' && this.phase !== 'stopped') return;
    if (this.deps.now() < this.notBefore) return;
    this.clearTimer('retry');
    this.stopped = null;
    await this.open();
  }

  /** Drops the connection and connects again, resuming if possible. */
  reconnect(reason: string): void {
    this.retryLater(reason, 0);
  }

  /** Leaves the session resumable (a code other than 1000 or 1001 keeps it alive on Discord's side). */
  shutdown(): void {
    this.drop();
    this.phase = 'idle';
  }

  private canResume(): boolean {
    return Boolean(this.session.sessionId && this.session.resumeUrl && this.session.seq !== null);
  }

  private async open(): Promise<void> {
    const gen = ++this.gen;
    this.phase = 'opening';
    this.resuming = this.canResume();
    this.setStatus(this.resuming ? 'resuming' : 'connecting');
    try {
      const url = this.resuming ? this.session.resumeUrl! : await this.deps.gatewayUrl();
      if (gen !== this.gen) return;
      const socket = await this.deps.connect(withParams(url), {
        message: (data) => this.onMessage(gen, data),
        close: (code, reason) => this.onClose(gen, code, reason),
      });
      if (gen !== this.gen) {
        socket.close(4000, 'superseded');
        return;
      }
      this.socket = socket;
      this.phase = 'hello';
      this.lastFrame = this.deps.now();
      this.timers.hello = this.deps.setTimer(() => {
        if (gen === this.gen) this.retryLater('Discord did not say hello');
      }, HELLO_TIMEOUT_MS);
    } catch (err) {
      if (gen === this.gen) this.failed(err);
    }
  }

  private failed(err: unknown): void {
    if (err instanceof GatewayStopError) return this.stop(err.message);
    if (err instanceof IdentifyLimitError) {
      this.notBefore = this.deps.now() + err.retryAfterMs;
      return this.retryLater(err.message, err.retryAfterMs, `waiting: Discord’s limit on new sessions is used up, trying again in ${Math.ceil(err.retryAfterMs / 60_000)} min`);
    }
    this.retryLater(err instanceof Error ? err.message : String(err));
  }

  private onMessage(gen: number, raw: string | ArrayBuffer): void {
    if (gen !== this.gen) return;
    this.lastFrame = this.deps.now();
    let frame: { op: number; d: unknown; s: number | null; t: string | null };
    try {
      frame = JSON.parse(typeof raw === 'string' ? raw : decoder.decode(raw));
    } catch {
      this.deps.log?.('gateway.unreadable_frame');
      return;
    }
    switch (frame.op) {
      case Op.Hello:
        return this.hello((frame.d as { heartbeat_interval: number }).heartbeat_interval);
      case Op.HeartbeatAck:
        this.acked = true;
        return this.deps.onHeartbeat?.();
      case Op.Heartbeat:
        return this.sendHeartbeat();
      case Op.Reconnect:
        return this.retryLater('Discord asked the relay to reconnect', 0);
      case Op.InvalidSession:
        return this.invalidSession(frame.d === true);
      case Op.Dispatch:
        return this.dispatch(frame.t ?? '', frame.d, frame.s);
    }
  }

  private hello(interval: number): void {
    this.clearTimer('hello');
    this.interval = interval;
    this.acked = true;
    // The first beat is jittered so a fleet of clients doesn't beat in step.
    this.timers.beat = this.deps.setTimer(() => this.beat(), interval * this.deps.random());
    this.handshake();
  }

  private handshake(): void {
    if (this.resuming && this.canResume()) {
      this.send({ op: Op.Resume, d: { token: this.deps.token, session_id: this.session.sessionId, seq: this.session.seq } });
      this.sent = 'resume';
      this.phase = 'resuming';
    } else {
      this.resuming = false;
      this.send({
        op: Op.Identify,
        d: { token: this.deps.token, intents: INTENTS, properties: { os: 'linux', browser: 'logitland', device: 'logitland' } },
      });
      this.sent = 'identify';
      this.phase = 'identifying';
    }
  }

  private beat(): void {
    if (!this.acked) {
      // No ACK since the last beat: the connection is a zombie. Any close code but 1000 or 1001 keeps the session.
      this.deps.log?.('gateway.zombie');
      return this.retryLater('The connection stopped answering heartbeats', 0);
    }
    this.sendHeartbeat();
    this.timers.beat = this.deps.setTimer(() => this.beat(), this.interval);
  }

  private sendHeartbeat(): void {
    this.send({ op: Op.Heartbeat, d: this.session.seq });
    this.acked = false;
  }

  private dispatch(t: string, d: unknown, s: number | null): void {
    if (typeof s === 'number') this.session = { ...this.session, seq: s };
    if (t === 'READY') {
      const ready = d as { session_id: string; resume_gateway_url: string };
      this.session = { sessionId: ready.session_id, resumeUrl: ready.resume_gateway_url, seq: s };
      this.deps.onSession?.(this.current, 'ready');
      return this.ready(false);
    }
    if (t === 'RESUMED') return this.ready(true);
    this.deps.onDispatch(t, d, s ?? 0);
  }

  private ready(resumed: boolean): void {
    this.phase = 'ready';
    this.attempts = 0;
    this.resumeRejections = 0;
    this.setStatus('connected');
    this.deps.onReady?.({ resumed });
  }

  // Opcode 9. The documentation says only that `d` tells whether the session may be resumed. Client libraries
  // wait a random 1 to 5 seconds first, which also keeps a rejected IDENTIFY from being repeated in a tight loop.
  private invalidSession(resumable: boolean): void {
    const wait = 1000 + this.deps.random() * 4000;
    this.clearTimer('invalid');
    if (resumable && this.sent === 'resume' && this.resumeRejections === 0) {
      this.resumeRejections++;
      this.timers.invalid = this.deps.setTimer(() => this.handshake(), wait);
      return;
    }
    if (this.session.sessionId) this.loseSession();
    this.timers.invalid = this.deps.setTimer(() => this.retryLater('Discord rejected the session', 0), wait);
  }

  private onClose(gen: number, code: number, reason: string): void {
    if (gen !== this.gen) return;
    this.socket = null;
    const c = classifyClose(code);
    this.deps.log?.('gateway.closed', { code, action: c.action });
    if (c.action === 'stop') return this.stop(c.status, `Discord closed the connection with code ${code}`);
    if (c.action === 'identify' && this.session.sessionId) this.loseSession();
    this.retryLater(`Discord closed the connection with code ${code}${reason ? ` (${reason.slice(0, 80)})` : ''}`);
  }

  private loseSession(): void {
    this.session = NO_SESSION;
    this.resuming = false;
    this.deps.onSession?.(NO_SESSION, 'lost');
  }

  private retryLater(reason: string, delayMs?: number, status = 'reconnecting'): void {
    this.drop();
    this.phase = 'waiting';
    this.setStatus(status, reason);
    this.timers.retry = this.deps.setTimer(() => void this.open(), delayMs ?? this.backoff());
  }

  // 0 to 1 s for the first retry, then 1, 2, 4 … 60 s with jitter.
  private backoff(): number {
    const n = this.attempts++;
    return n === 0 ? this.deps.random() * 1000 : Math.min(60_000, 1000 * 2 ** (n - 1)) * (0.5 + this.deps.random() / 2);
  }

  private stop(status: string, error?: string): void {
    this.drop();
    this.phase = 'stopped';
    this.stopped = status;
    this.setStatus(status, error);
  }

  private drop(): void {
    this.gen++;
    for (const name of Object.keys(this.timers) as TimerName[]) this.clearTimer(name);
    const socket = this.socket;
    this.socket = null;
    socket?.close(4000, 'reconnecting');
  }

  private clearTimer(name: TimerName): void {
    this.timers[name]?.();
    delete this.timers[name];
  }

  private send(frame: { op: number; d: unknown }): void {
    this.socket?.send(JSON.stringify(frame));
  }

  private setStatus(status: string, error?: string): void {
    this.deps.onStatus(status, error);
  }
}
