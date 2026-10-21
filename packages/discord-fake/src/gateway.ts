// The fake Gateway: HELLO, IDENTIFY, READY and GUILD_CREATE, heartbeats, dispatches with increasing sequence numbers,
// RESUME with replay, INVALID_SESSION, RECONNECT and the documented close codes. Intents are respected: message content
// is empty unless MESSAGE_CONTENT was identified. https://docs.discord.com/developers/events/gateway

import { randomBytes } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';
import { AppFlag, Intent, VALID_INTENT_MASK, type Channel } from './model.ts';
import { acceptUpgrade, type WebSocketConnection } from './websocket.ts';
import type { World } from './world.ts';

const Op = {
  Dispatch: 0,
  Heartbeat: 1,
  Identify: 2,
  PresenceUpdate: 3,
  VoiceStateUpdate: 4,
  Resume: 6,
  Reconnect: 7,
  RequestGuildMembers: 8,
  InvalidSession: 9,
  Hello: 10,
  HeartbeatAck: 11,
} as const;

/** Close codes the fake sends. https://docs.discord.com/developers/topics/opcodes-and-status-codes */
export const CloseCode = {
  unknownError: 4000,
  unknownOpcode: 4001,
  decodeError: 4002,
  notAuthenticated: 4003,
  authenticationFailed: 4004,
  alreadyAuthenticated: 4005,
  invalidSeq: 4007,
  rateLimited: 4008,
  sessionTimedOut: 4009,
  invalidShard: 4010,
  shardingRequired: 4011,
  invalidApiVersion: 4012,
  invalidIntents: 4013,
  disallowedIntents: 4014,
} as const;

/** Close codes after which Discord expects a fresh IDENTIFY rather than a RESUME. */
const FRESH_SESSION_CODES = new Set<number>([CloseCode.notAuthenticated, CloseCode.invalidSeq, CloseCode.sessionTimedOut]);

const EVENT_INTENT: Record<string, number> = {
  GUILD_CREATE: Intent.guilds,
  GUILD_ROLE_CREATE: Intent.guilds,
  CHANNEL_CREATE: Intent.guilds,
  CHANNEL_UPDATE: Intent.guilds,
  CHANNEL_DELETE: Intent.guilds,
  THREAD_CREATE: Intent.guilds,
  THREAD_UPDATE: Intent.guilds,
  THREAD_DELETE: Intent.guilds,
  GUILD_MEMBER_UPDATE: Intent.guildMembers,
  MESSAGE_CREATE: Intent.guildMessages,
  MESSAGE_UPDATE: Intent.guildMessages,
  MESSAGE_DELETE: Intent.guildMessages,
  MESSAGE_DELETE_BULK: Intent.guildMessages,
};

const RATE_LIMIT_EVENTS = 120;
const RATE_LIMIT_WINDOW_MS = 60_000;

export interface GatewayOptions {
  /** HELLO's heartbeat_interval. Discord sends about 41250; tests use a small one. */
  heartbeatIntervalMs: number;
  /** How long a disconnected session can still be resumed. */
  resumeWindowMs: number;
  /** Delay between a change and the Gateway telling clients, so tests can make the REST answer arrive first. */
  eventLagMs: number;
  /** Dispatches kept per session for replay. */
  bufferLimit: number;
}

export const DEFAULT_GATEWAY_OPTIONS: GatewayOptions = { heartbeatIntervalMs: 41_250, resumeWindowMs: 120_000, eventLagMs: 0, bufferLimit: 10_000 };

interface Frame {
  op: number;
  d: unknown;
  s?: number | null;
  t?: string | null;
}

interface Buffered {
  s: number;
  t: string;
  d: Record<string, unknown>;
}

class Session {
  readonly id = randomBytes(16).toString('hex');
  seq = 0;
  readonly buffer: Buffered[] = [];
  connection: Connection | null = null;
  disconnectedAt: number | null = null;
  expired = false;
  resumes = 0;
  heartbeats = 0;
  lastHeartbeatAt: number | null = null;
  readonly userId: string;
  readonly intents: number;
  readonly shard: [number, number] | null;
  readonly createdAt: number;

  constructor(userId: string, intents: number, shard: [number, number] | null, createdAt: number) {
    this.userId = userId;
    this.intents = intents;
    this.shard = shard;
    this.createdAt = createdAt;
  }
}

class Connection {
  readonly id = randomBytes(4).toString('hex');
  session: Session | null = null;
  readonly ws: WebSocketConnection;
  readonly outbox: { due: number; frame: Frame }[] = [];
  timer: NodeJS.Timeout | null = null;
  inbound: number[] = [];
  readonly openedAt: number;

  constructor(ws: WebSocketConnection, openedAt: number) {
    this.ws = ws;
    this.openedAt = openedAt;
  }
}

export interface SessionInfo {
  id: string;
  user_id: string;
  intents: number;
  connected: boolean;
  seq: number;
  buffered: number;
  heartbeats: number;
  last_heartbeat_at: string | null;
  resumes: number;
  expired: boolean;
}

export interface RecordedFrame {
  at: string;
  connection: string;
  session: string | null;
  direction: 'in' | 'out';
  op: number;
  t: string | null;
  s: number | null;
  d: unknown;
}

export interface GatewayDeps {
  world: World;
  now: () => number;
  botToken: () => string;
  application: () => { id: string; flags: number };
  /** The URL to hand out as resume_gateway_url. */
  url: () => string;
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

export class Gateway {
  readonly options: GatewayOptions;
  /** Set to false and the fake stops answering heartbeats: the connection is a zombie. */
  ackHeartbeats = true;
  /** What the next RESUME gets: normally it works. */
  nextResume: 'ok' | 'invalid' | 'invalid-resumable' = 'ok';
  /** Sessions Discord will still let this bot start, as GET /gateway/bot reports it. */
  sessionStartLimit = { total: 1000, remaining: 1000, resetAt: 0, maxConcurrency: 1 };
  readonly frames: RecordedFrame[] = [];
  private readonly sessions = new Map<string, Session>();
  private readonly connections = new Set<Connection>();
  private readonly deps: GatewayDeps;

  constructor(deps: GatewayDeps, options: Partial<GatewayOptions> = {}) {
    this.deps = deps;
    this.options = { ...DEFAULT_GATEWAY_OPTIONS, ...options };
    this.sessionStartLimit.resetAt = deps.now() + 86_400_000;
  }

  /* ---------- Control ---------- */

  info(): SessionInfo[] {
    return [...this.sessions.values()].map((s) => ({
      id: s.id,
      user_id: s.userId,
      intents: s.intents,
      connected: s.connection !== null,
      seq: s.seq,
      buffered: s.buffer.length,
      heartbeats: s.heartbeats,
      last_heartbeat_at: s.lastHeartbeatAt === null ? null : new Date(s.lastHeartbeatAt).toISOString(),
      resumes: s.resumes,
      expired: s.expired,
    }));
  }

  get connected(): number {
    return [...this.connections].filter((c) => c.session !== null).length;
  }

  /** Every frame the clients sent, optionally by opcode name (IDENTIFY, RESUME, HEARTBEAT). */
  received(name?: 'IDENTIFY' | 'RESUME' | 'HEARTBEAT'): RecordedFrame[] {
    const op = name === undefined ? null : { IDENTIFY: Op.Identify, RESUME: Op.Resume, HEARTBEAT: Op.Heartbeat }[name];
    return this.frames.filter((f) => f.direction === 'in' && (op === null || f.op === op));
  }

  /** Dispatches and other frames the fake sent, optionally by event name. */
  sent(t?: string): RecordedFrame[] {
    return this.frames.filter((f) => f.direction === 'out' && (t === undefined || f.t === t));
  }

  /** Tells every connected client to reconnect (opcode 7). They are expected to resume. */
  reconnect(): void {
    for (const c of this.connections) if (c.session) this.send(c, { op: Op.Reconnect, d: null });
  }

  /** Sends opcode 9 to every connected client without closing the socket. */
  invalidate(resumable: boolean): void {
    for (const c of this.connections) if (c.session) this.send(c, { op: Op.InvalidSession, d: resumable });
  }

  /**
   * Closes every connection with this code. Sessions stay resumable unless `forget` is set or the code is one after which
   * Discord wants a new session (4003, 4007, 4009).
   */
  close(code: number = CloseCode.unknownError, reason = '', opts: { forget?: boolean } = {}): void {
    for (const c of [...this.connections]) {
      if (c.session && (opts.forget || FRESH_SESSION_CODES.has(code))) c.session.expired = true;
      c.ws.close(code, reason);
    }
  }

  /** Drops every socket with no close frame, like a lost network. */
  drop(): void {
    for (const c of [...this.connections]) c.ws.terminate();
  }

  /** Marks all sessions as gone: the next RESUME is answered with INVALID_SESSION (false). */
  forgetSessions(): void {
    for (const s of this.sessions.values()) s.expired = true;
  }

  /** Writes text straight to every connected client, for protocol edge cases such as an unreadable frame. */
  sendRaw(text: string): void {
    for (const c of this.connections) if (c.session) c.ws.sendText(text);
  }

  /** Closes everything and forgets all sessions. */
  shutdown(): void {
    for (const c of [...this.connections]) c.ws.terminate();
    for (const c of this.connections) if (c.timer) clearTimeout(c.timer);
    this.connections.clear();
    this.sessions.clear();
  }

  /* ---------- Events ---------- */

  /** Sends a dispatch to every session whose intents include it, in order, with the next sequence number. */
  dispatch(t: string, d: Record<string, unknown>): void {
    const bit = EVENT_INTENT[t];
    if (bit === undefined) return;
    for (const session of this.sessions.values()) {
      if (session.expired || !(session.intents & bit)) continue;
      this.queue(session, t, this.forSession(session, t, d), true);
    }
  }

  /** What a session may see of a payload: message text needs the MESSAGE_CONTENT intent. */
  private forSession(session: Session, t: string, d: Record<string, unknown>): Record<string, unknown> {
    if ((t !== 'MESSAGE_CREATE' && t !== 'MESSAGE_UPDATE') || session.intents & Intent.messageContent) return d;
    const author = d.author as { id?: string } | undefined;
    const mentioned = Array.isArray(d.mentions) && (d.mentions as { id?: string }[]).some((u) => u.id === session.userId);
    if (author?.id === session.userId || mentioned) return d;
    const { poll: _poll, ...rest } = d;
    return { ...rest, content: '', embeds: [], attachments: [], components: [] };
  }

  private queue(session: Session, t: string, d: Record<string, unknown>, lag: boolean): void {
    const s = ++session.seq;
    session.buffer.push({ s, t, d });
    if (session.buffer.length > this.options.bufferLimit) session.buffer.shift();
    const conn = session.connection;
    if (!conn) return;
    const frame: Frame = { op: Op.Dispatch, d, s, t };
    const delay = lag ? this.options.eventLagMs : 0;
    if (delay <= 0 && conn.outbox.length === 0) return this.send(conn, frame);
    conn.outbox.push({ due: this.deps.now() + delay, frame });
    this.pump(conn);
  }

  private pump(conn: Connection): void {
    if (conn.timer) return;
    const step = () => {
      conn.timer = null;
      while (conn.outbox.length && conn.outbox[0]!.due <= this.deps.now()) this.send(conn, conn.outbox.shift()!.frame);
      if (conn.outbox.length) {
        conn.timer = setTimeout(step, Math.max(1, conn.outbox[0]!.due - this.deps.now()));
        conn.timer.unref();
      }
    };
    step();
  }

  private send(conn: Connection, frame: Frame): void {
    this.record(conn, 'out', frame);
    // Discord sends s and t on every frame; they are null unless it is a dispatch.
    conn.ws.sendText(JSON.stringify({ t: null, s: null, ...frame }));
  }

  private record(conn: Connection, direction: 'in' | 'out', frame: Frame): void {
    this.frames.push({
      at: new Date(this.deps.now()).toISOString(),
      connection: conn.id,
      session: conn.session?.id ?? null,
      direction,
      op: frame.op,
      t: frame.t ?? null,
      s: typeof frame.s === 'number' ? frame.s : null,
      d: frame.d,
    });
    if (this.frames.length > 5000) this.frames.splice(0, this.frames.length - 5000);
  }

  /* ---------- Connections ---------- */

  /** Handles an HTTP upgrade on the Gateway path. */
  upgrade(req: IncomingMessage, socket: Duplex, head: Buffer): void {
    const ws = acceptUpgrade(req, socket, head);
    if (!ws) return;
    const conn = new Connection(ws, this.deps.now());
    this.connections.add(conn);
    ws.onClose = () => this.disconnected(conn);
    ws.onText = (text) => this.onText(conn, text);
    const url = new URL(req.url ?? '/', 'http://fake');
    if (!['9', '10'].includes(url.searchParams.get('v') ?? '')) return void ws.close(CloseCode.invalidApiVersion, 'Invalid API version');
    if ((url.searchParams.get('encoding') ?? 'json') !== 'json' || url.searchParams.has('compress'))
      return void ws.close(CloseCode.decodeError, 'Only uncompressed JSON is supported');
    this.send(conn, { op: Op.Hello, d: { heartbeat_interval: this.options.heartbeatIntervalMs } });
  }

  private disconnected(conn: Connection): void {
    this.connections.delete(conn);
    if (conn.timer) clearTimeout(conn.timer);
    conn.outbox.length = 0;
    const session = conn.session;
    if (session && session.connection === conn) {
      session.connection = null;
      session.disconnectedAt = this.deps.now();
    }
  }

  private close_(conn: Connection, code: number, reason: string): void {
    conn.ws.close(code, reason);
  }

  private onText(conn: Connection, text: string): void {
    const now = this.deps.now();
    conn.inbound = conn.inbound.filter((t) => now - t < RATE_LIMIT_WINDOW_MS);
    conn.inbound.push(now);
    if (conn.inbound.length > RATE_LIMIT_EVENTS) return this.close_(conn, CloseCode.rateLimited, 'Rate limited.');
    let frame: Frame;
    try {
      const parsed = JSON.parse(text) as unknown;
      if (!isObject(parsed)) throw new Error('not an object');
      frame = parsed as unknown as Frame;
    } catch {
      return this.close_(conn, CloseCode.decodeError, 'Decode error');
    }
    if (!Number.isInteger(frame.op)) return this.close_(conn, CloseCode.decodeError, 'Decode error');
    this.record(conn, 'in', frame);
    switch (frame.op) {
      case Op.Heartbeat:
        return this.heartbeat(conn, frame);
      case Op.Identify:
        return this.identify(conn, frame.d);
      case Op.Resume:
        return this.resume(conn, frame.d);
      case Op.PresenceUpdate:
      case Op.VoiceStateUpdate:
      case Op.RequestGuildMembers:
        if (!conn.session) return this.close_(conn, CloseCode.notAuthenticated, 'Not authenticated.');
        return;
      default:
        return this.close_(conn, CloseCode.unknownOpcode, 'Unknown opcode.');
    }
  }

  private heartbeat(conn: Connection, frame: Frame): void {
    if (frame.d !== null && !Number.isInteger(frame.d)) return this.close_(conn, CloseCode.decodeError, 'Decode error');
    if (conn.session) {
      conn.session.heartbeats++;
      conn.session.lastHeartbeatAt = this.deps.now();
    }
    if (this.ackHeartbeats) this.send(conn, { op: Op.HeartbeatAck, d: null });
  }

  private identify(conn: Connection, d: unknown): void {
    if (conn.session) return this.close_(conn, CloseCode.alreadyAuthenticated, 'Already authenticated.');
    if (!isObject(d) || typeof d.token !== 'string' || !isObject(d.properties)) return this.close_(conn, CloseCode.decodeError, 'Decode error');
    if (d.token !== this.deps.botToken()) return this.close_(conn, CloseCode.authenticationFailed, 'Authentication failed.');
    let shard: [number, number] | null = null;
    if (d.shard !== undefined) {
      const s = d.shard;
      if (
        !Array.isArray(s) ||
        s.length !== 2 ||
        !s.every(Number.isInteger) ||
        (s[0] as number) < 0 ||
        (s[1] as number) < 1 ||
        (s[0] as number) >= (s[1] as number)
      )
        return this.close_(conn, CloseCode.invalidShard, 'Invalid shard.');
      shard = [s[0] as number, s[1] as number];
    }
    const intents = d.intents;
    if (typeof intents !== 'number' || !Number.isInteger(intents) || intents < 0 || (intents & ~VALID_INTENT_MASK) !== 0)
      return this.close_(conn, CloseCode.invalidIntents, 'Invalid intent(s).');
    const flags = this.deps.application().flags;
    if (
      (intents & Intent.messageContent && !(flags & AppFlag.messageContent)) ||
      (intents & Intent.guildMembers && !(flags & AppFlag.guildMembers)) ||
      (intents & Intent.guildPresences && !(flags & AppFlag.presence))
    )
      return this.close_(conn, CloseCode.disallowedIntents, 'Disallowed intent(s).');

    const limit = this.sessionStartLimit;
    if (limit.remaining <= 0) return this.send(conn, { op: Op.InvalidSession, d: false });
    limit.remaining--;

    const world = this.deps.world;
    const session = new Session(world.botUser.id, intents, shard, this.deps.now());
    this.sessions.set(session.id, session);
    session.connection = conn;
    conn.session = session;
    const guilds = [...world.guilds.values()].filter((g) => g.members.has(world.botUser.id));
    this.queue(
      session,
      'READY',
      {
        v: 10,
        user: { ...world.botUser, verified: true, mfa_enabled: false, flags: 0 },
        guilds: guilds.map((g) => ({ id: g.id, unavailable: true })),
        session_id: session.id,
        resume_gateway_url: this.deps.url(),
        ...(shard ? { shard } : {}),
        application: { id: this.deps.application().id, flags: this.deps.application().flags },
        session_type: 'normal',
      },
      false,
    );
    for (const g of guilds) this.queue(session, 'GUILD_CREATE', this.guildCreate(g.id, session), false);
  }

  /** GUILD_CREATE. Channels and threads inside it carry no guild_id, as on Discord. */
  private guildCreate(guildId: string, session: Session): Record<string, unknown> {
    const world = this.deps.world;
    const guild = world.guild(guildId);
    const strip = (c: Channel) => {
      const { guild_id: _guild, ...rest } = c;
      return rest;
    };
    const withChannels = (session.intents & Intent.guilds) !== 0;
    const members = [...guild.members.values()].filter((m) => m.user.id === session.userId || session.intents & Intent.guildMembers);
    return {
      id: guild.id,
      name: guild.name,
      icon: null,
      owner_id: guild.owner_id,
      roles: [...guild.roles.values()],
      emojis: [],
      stickers: [],
      features: [],
      premium_tier: 0,
      preferred_locale: 'en-US',
      joined_at: guild.createdAt,
      large: false,
      unavailable: false,
      member_count: guild.members.size,
      voice_states: [],
      members,
      channels: withChannels ? world.guildChannels(guildId).map(strip) : [],
      threads: withChannels ? world.activeThreads(guildId).map(strip) : [],
      presences: [],
      stage_instances: [],
      guild_scheduled_events: [],
      soundboard_sounds: [],
    };
  }

  private resume(conn: Connection, d: unknown): void {
    if (conn.session) return this.close_(conn, CloseCode.alreadyAuthenticated, 'Already authenticated.');
    if (!isObject(d) || typeof d.token !== 'string' || typeof d.session_id !== 'string' || !Number.isInteger(d.seq))
      return this.close_(conn, CloseCode.decodeError, 'Decode error');
    if (d.token !== this.deps.botToken()) return this.close_(conn, CloseCode.authenticationFailed, 'Authentication failed.');
    const session = this.sessions.get(d.session_id);
    const mode = this.nextResume;
    this.nextResume = 'ok';
    const stale = !session || session.expired || (session.disconnectedAt !== null && this.deps.now() - session.disconnectedAt > this.options.resumeWindowMs);
    if (mode === 'invalid-resumable') return this.send(conn, { op: Op.InvalidSession, d: true });
    if (mode === 'invalid' || stale) {
      if (session) session.expired = true;
      return this.send(conn, { op: Op.InvalidSession, d: false });
    }
    const seq = d.seq as number;
    if (seq > session.seq || seq < 0) return this.close_(conn, CloseCode.invalidSeq, 'Invalid seq');
    const oldest = session.buffer[0]?.s ?? session.seq + 1;
    if (seq + 1 < oldest) return this.send(conn, { op: Op.InvalidSession, d: false });

    // A connection still attached to this session is replaced by the new one.
    const previous = session.connection;
    if (previous && previous !== conn) {
      previous.session = null;
      previous.ws.close(CloseCode.unknownError, 'Session resumed elsewhere');
    }
    session.connection = conn;
    session.disconnectedAt = null;
    session.resumes++;
    conn.session = session;
    for (const e of session.buffer) if (e.s > seq) this.send(conn, { op: Op.Dispatch, d: e.d, s: e.s, t: e.t });
    // RESUMED takes the next sequence number but is not kept for replay.
    const s = ++session.seq;
    this.send(conn, { op: Op.Dispatch, d: {}, s, t: 'RESUMED' });
  }
}
