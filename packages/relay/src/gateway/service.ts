import { DiscordError } from '@logitland/discord';
import { iso, type Relay } from '../context';
import { ingest, recordGap, saveIntakeState, type IntakeEventInput } from '../services/intake';
import { backfill, seedHistory } from './backfill';
import { metered } from './budget';
import { channelChanges, messageChannelId, normalizeDispatch, threadEvents, type DiscordChannelLike } from './normalize';
import { GatewayConnection, GatewayStopError, IdentifyLimitError, type GatewaySession, type GatewaySocket, type SocketEvents } from './protocol';

// Everything the Discord Gateway Durable Object does apart from owning a WebSocket and storage: it keeps the
// connection alive, buffers dispatches and writes them to the relay in order, keeps session state across
// restarts, mirrors health into intake_state, and recovers after a lost session. The Durable Object
// (apps/backend/src/gateway.ts) supplies the host; tests supply a fake one.

/** Dispatches are written to D1 in batches, about this often or this large. */
export const FLUSH_MS = 500;
export const FLUSH_EVENTS = 50;
const BATCH_EVENTS = 100;
/** The alarm that wakes an evicted Durable Object, set shorter than a heartbeat interval (about 41 s). */
export const WAKE_MS = 30_000;
const MIRROR_MS = 15_000;
/** A fatal stop (wrong token, intent not enabled) is tried again this often, in case it has been fixed. */
export const STOP_RETRY_MS = 10 * 60_000;
/** A cap on REST pages per run. The D1 query budget (budget.ts) usually stops a run first. */
const BACKFILL_PAGES = 10;
/** Work left over after a run's query budget goes to the next alarm, which starts a fresh invocation. */
export const CONTINUE_MS = 1_000;
/** Places new to the relay are looked for this often unless an event says there may be one (or the last look found many). */
export const SEED_CHECK_MS = 5 * 60_000;
const FLUSH_RETRY_MS = 5_000;
/** Past this many waiting events (the database is down, or far behind) the oldest are dropped and made up for later. */
export const BUFFER_CAP = 5_000;
/** Places (channels and threads with no cursor) looked at per run when a channel is new to the relay. */
const SEED_PLACES = 10;

export interface GatewayStorage {
  get<T>(key: string): Promise<T | undefined>;
  put(key: string, value: unknown): Promise<void>;
  delete(key: string): Promise<unknown>;
}

export interface GatewayHost {
  relay: Relay;
  token: string;
  storage: GatewayStorage;
  connect(url: string, events: SocketEvents): Promise<GatewaySocket>;
  setTimer(fn: () => void, ms: number): () => void;
  /** Wake the host at this time (a Durable Object alarm), even if it has been evicted. */
  wakeAt(epochMs: number): Promise<void>;
  now(): number;
  random(): number;
  /** Defaults to BUFFER_CAP. */
  bufferCap?: number;
}

interface Buffered {
  event: IntakeEventInput;
  seq: number;
  gen: number;
  at: string;
}

/** Events dropped from a full buffer: which channels they were in, and from when. */
interface Loss {
  since: string;
  until: string;
  channels: string[];
}

/** The older of two message IDs (a snowflake doesn't fit a number); either may be missing. */
const older = (a: string | undefined, b: string): string => (a !== undefined && BigInt(a) < BigInt(b) ? a : b);

const GAP_REASON =
  'The relay lost its Discord session. Messages sent in this window are being fetched again, but edits and deletions made during it can’t be recovered.';

export class GatewayService {
  private readonly relay: Relay;
  private readonly conn: GatewayConnection;
  private loading: Promise<void> | null = null;
  private status = 'not started';
  private lastError: string | null = null;
  private lastEventAt: string | null = null;
  private lastHeartbeatAt: string | null = null;
  private stoppedAt: number | null = null;

  private buffer: Buffered[] = [];
  /** Bumped at each new session: sequence numbers restart with it. */
  private gen = 0;
  /** The highest sequence number handled, and the highest stored safely (what a restart may resume from). */
  private handled = 0;
  private durable: number | null = null;
  private chain: Promise<void> = Promise.resolve();
  private flushing: Promise<void> = Promise.resolve();
  private cancelFlush: (() => void) | null = null;
  private cancelBackfill: (() => void) | null = null;
  private lastMirror = 0;
  private backfilling = false;
  private pendingBackfill = false;
  private seeding = false;
  private cancelSeed: (() => void) | null = null;
  private seedWanted = true;
  private lastSeedCheck = 0;
  /** Reads and writes of the 'backfill' storage key take turns here; see openGap and runBackfill. */
  private backfillLock: Promise<unknown> = Promise.resolve();
  /** Cursors openGap stored while a backfill run was away fetching, so the run's final write keeps them. */
  private readonly added = new Map<string, string>();
  private lost: Loss | null = null;

  private readonly threads = new Map<string, string>();
  /** Channels known not to be threads, so a message in an unknown channel is looked up once. */
  private readonly plain = new Set<string>();

  constructor(private readonly host: GatewayHost) {
    this.relay = host.relay;
    this.conn = new GatewayConnection({
      token: host.token,
      gatewayUrl: () => this.gatewayUrl(),
      connect: (url, events) => host.connect(url, events),
      setTimer: (fn, ms) => host.setTimer(fn, ms),
      now: () => host.now(),
      random: () => host.random(),
      onDispatch: (t, d, s) => this.enqueue(() => this.handle(t, d, s)),
      onStatus: (status, error) => this.onStatus(status, error),
      onSession: (session, why) => this.onSession(session, why),
      onReady: ({ resumed }) => this.enqueue(() => this.afterReady(resumed)),
      onHeartbeat: () => {
        this.lastHeartbeatAt = iso(this.relay.now());
        void this.mirror(false);
      },
      log: (event, fields) => this.relay.log.info(event, fields),
    });
  }

  /** Connects if not connected, and arms the alarm. Cron calls it every minute. */
  async ensure(): Promise<void> {
    await this.load();
    if (!this.host.token) {
      const status = 'stopped: DISCORD_BOT_TOKEN is not set, so the relay can’t read the Discord server';
      if (this.status !== status) {
        this.status = status;
        void this.mirror(true);
      }
      return;
    }
    if (this.stoppedAt !== null && this.host.now() < this.stoppedAt + STOP_RETRY_MS) {
      await this.host.wakeAt(this.stoppedAt + STOP_RETRY_MS);
      return;
    }
    // A connection that has gone quiet for more than a couple of heartbeats is dead even if no timer noticed.
    if (this.conn.state === 'ready' && this.host.now() - this.conn.lastFrameAt > 2 * this.conn.heartbeatMs + 15_000)
      this.conn.reconnect('The connection went quiet');
    await this.conn.start();
    await this.host.wakeAt(this.host.now() + WAKE_MS);
    if (this.buffer.length || this.lost) void this.flush();
    if (this.pendingBackfill) void this.runBackfill();
    if (this.seedWanted || this.host.now() - this.lastSeedCheck >= SEED_CHECK_MS) void this.seed();
  }

  /** The alarm backstop: after an eviction this brings the connection back; otherwise it checks on it. */
  async tick(): Promise<void> {
    await this.ensure();
  }

  /** Drops the connection (leaving the session resumable) and cancels pending timers. For tests and orderly shutdowns. */
  shutdown(): void {
    this.conn.shutdown();
    this.cancelFlush?.();
    this.cancelFlush = null;
    this.cancelBackfill?.();
    this.cancelBackfill = null;
    this.cancelSeed?.();
    this.cancelSeed = null;
  }

  async report(): Promise<Record<string, unknown>> {
    await this.load();
    return this.snapshot();
  }

  snapshot(): Record<string, unknown> {
    const session = this.conn.current;
    return {
      status: this.status,
      last_event_at: this.lastEventAt,
      last_heartbeat_at: this.lastHeartbeatAt,
      last_error: this.lastError,
      resumable: Boolean(session.sessionId),
      seq: this.durable,
      buffered: this.buffer.length,
      backfill_pending: this.pendingBackfill,
      events_dropped: Boolean(this.lost),
    };
  }

  private load(): Promise<void> {
    // A failed load must not be remembered: the next call tries again instead of failing until the object is evicted.
    this.loading ??= (async () => {
      const { storage } = this.host;
      const session = await storage.get<GatewaySession>('session');
      if (session?.sessionId) {
        this.conn.restore(session);
        this.handled = session.seq ?? 0;
        this.durable = session.seq;
      }
      const stored = await this.storedState();
      this.lastEventAt = (await storage.get<string>('lastEventAt')) ?? stored?.last_event_at ?? null;
      this.stoppedAt = (await storage.get<number>('stoppedAt')) ?? null;
      // Until this instance connects, the last known state is the best answer.
      if (stored) {
        this.status = stored.status;
        this.lastError = stored.last_error;
        this.lastHeartbeatAt = stored.last_heartbeat_at;
      }
      this.pendingBackfill = Boolean(await storage.get('backfill'));
      this.lost = (await storage.get<Loss>('lost')) ?? null;
      const { results: channels } = await this.relay.db.prepare('SELECT id FROM channels').all<{ id: string }>();
      for (const c of channels) this.plain.add(c.id);
      const { results: threads } = await this.relay.db
        .prepare('SELECT CAST(id AS TEXT) AS id, parent_id FROM threads')
        .all<{ id: string; parent_id: string }>();
      for (const t of threads) this.threads.set(t.id, t.parent_id);
    })().catch((error) => {
      this.loading = null;
      throw error;
    });
    return this.loading;
  }

  private async storedState(): Promise<{ status: string; last_event_at: string | null; last_heartbeat_at: string | null; last_error: string | null } | null> {
    return this.relay.db.prepare("SELECT status, last_event_at, last_heartbeat_at, last_error FROM intake_state WHERE source = 'gateway'").first();
  }

  private async gatewayUrl(): Promise<string> {
    try {
      const info = await this.relay.discord.getGatewayBot();
      if (info.session_start_limit.remaining < 1) throw new IdentifyLimitError(info.session_start_limit.reset_after);
      return info.url;
    } catch (err) {
      if (err instanceof DiscordError && err.status === 401) throw new GatewayStopError('stopped: Discord rejected the bot token. Check DISCORD_BOT_TOKEN');
      throw err;
    }
  }

  private store(key: string, value: unknown): void {
    this.host.storage.put(key, value).catch((error) => this.relay.log.error('gateway.storage_failed', { key, error }));
  }

  private forget(key: string): void {
    this.host.storage.delete(key).catch((error) => this.relay.log.error('gateway.storage_failed', { key, error }));
  }

  private onStatus(status: string, error?: string): void {
    this.status = status;
    if (error) this.lastError = error.slice(0, 300);
    if (status.startsWith('stopped')) {
      this.stoppedAt = this.host.now();
      this.store('stoppedAt', this.stoppedAt);
    } else if (this.stoppedAt !== null) {
      this.stoppedAt = null;
      this.forget('stoppedAt');
    }
    this.relay.log.info('gateway.status', { status });
    void this.mirror(true);
  }

  private onSession(session: GatewaySession, why: 'ready' | 'lost'): void {
    if (why === 'lost') {
      this.durable = null;
      this.forget('session');
      return;
    }
    // A new session restarts sequence numbers. The old session's entries were flushed in afterReady, or still wait to be.
    this.gen++;
    this.handled = session.seq ?? 0;
    this.durable = session.seq;
    this.store('session', session);
  }

  /** Dispatches are handled one at a time, in order, because looking up an unknown thread is asynchronous. */
  private enqueue(work: () => Promise<void>): void {
    this.chain = this.chain.then(work).catch((error) => this.relay.log.error('gateway.dispatch_failed', { error }));
  }

  private async handle(t: string, d: unknown, s: number): Promise<void> {
    const at = iso(this.relay.now());
    this.lastEventAt = at;
    const { add, remove } = channelChanges(t, d);
    for (const id of add) this.plain.add(id);
    for (const id of remove) this.plain.delete(id);
    if (add.length) this.seedWanted = true;
    const channelId = messageChannelId(t, d);
    if (channelId) await this.lookUp(channelId, s);
    for (const event of normalizeDispatch(t, d, { guildId: this.relay.config.discord.guildId, threads: this.threads })) {
      if (event.kind === 'thread_upsert') this.seedWanted = true;
      this.buffer.push({ event, seq: s, gen: this.gen, at });
    }
    this.handled = s;
    if (this.buffer.length > (this.host.bufferCap ?? BUFFER_CAP)) this.dropOldest();
    if (this.buffer.length >= FLUSH_EVENTS) void this.flush();
    else this.flushSoon(FLUSH_MS);
  }

  // A message in a channel the relay hasn't heard of may be in a thread it missed (made while disconnected, say).
  private async lookUp(channelId: string, seq: number): Promise<void> {
    if (this.threads.has(channelId) || this.plain.has(channelId)) return;
    try {
      const channel = (await this.relay.discord.getChannel(channelId)) as unknown as DiscordChannelLike;
      const found = threadEvents([channel], { guildId: null, threads: this.threads });
      if (found.length) {
        this.seedWanted = true;
        for (const event of found) this.buffer.push({ event, seq, gen: this.gen, at: iso(this.relay.now()) });
      } else this.plain.add(channelId);
    } catch (error) {
      this.relay.log.warn('gateway.channel_lookup_failed', { channel_id: channelId, error });
    }
  }

  // The oldest waiting events go first, and the channels they were in are remembered (and kept, in case the
  // object is evicted) so that once the database answers again, a gap is recorded and the messages are fetched anew.
  private dropOldest(): void {
    const dropped = this.buffer.splice(0, this.buffer.length - (this.host.bufferCap ?? BUFFER_CAP));
    const channels = new Set(this.lost?.channels);
    for (const { event } of dropped) {
      if ('parent_id' in event) channels.add(event.parent_id);
      else if ('channel_id' in event) channels.add(event.channel_id);
    }
    const first = this.lost === null;
    const grew = channels.size > (this.lost?.channels.length ?? 0);
    this.lost = { since: this.lost?.since ?? dropped[0]!.at, until: dropped[dropped.length - 1]!.at, channels: [...channels] };
    if (first || grew) this.store('lost', this.lost);
    if (first) this.relay.log.error('gateway.buffer_full', { dropped: dropped.length });
  }

  private flushSoon(ms: number): void {
    if (this.cancelFlush) return;
    this.cancelFlush = this.host.setTimer(() => {
      this.cancelFlush = null;
      void this.flush();
    }, ms);
  }

  /** Writes what is buffered to the relay in order. Calls queue, so batches never overlap. */
  flush(): Promise<void> {
    // A failed write must not poison the queue: the next flush has to run.
    this.flushing = this.flushing
      .then(() => this.flushOnce())
      .catch((error) => {
        this.relay.log.error('gateway.flush_failed', { error });
        this.flushSoon(FLUSH_RETRY_MS);
      });
    return this.flushing;
  }

  private async flushOnce(): Promise<void> {
    this.cancelFlush?.();
    this.cancelFlush = null;
    // Events were dropped while the database was out of reach. It answers again once this works: record the gap before
    // anything newer is written, and remember where the channels stood so the missing messages can be fetched.
    const lost = this.lost;
    if (lost) {
      try {
        await this.openGap(lost.since, lost.until, lost.channels, true);
      } catch (error) {
        this.relay.log.error('gateway.loss_not_recovered', { error });
        this.lastError = 'Events were dropped while the database was unreachable; will make up for them';
        this.flushSoon(FLUSH_RETRY_MS);
        return;
      }
      if (this.lost === lost) {
        this.lost = null;
        this.forget('lost');
      }
    }
    const budget = metered(this.relay);
    while (this.buffer.length && budget.room()) {
      const part = this.buffer.slice(0, BATCH_EVENTS);
      try {
        await ingest(budget.relay, { source: 'gateway', events: part.map((b) => b.event) });
      } catch (error) {
        // The buffer stays as it is: the batch is safe to send again, and the stored sequence hasn't moved.
        this.relay.log.error('gateway.flush_failed', { buffered: this.buffer.length, error });
        this.lastError = 'Writing events to the database failed; retrying';
        this.flushSoon(FLUSH_RETRY_MS);
        return;
      }
      this.buffer.splice(0, part.length);
    }
    // Everything before the first entry still waiting (or everything handled) is stored; resume from there.
    const waiting = this.buffer.find((b) => b.gen === this.gen);
    const durable = waiting ? waiting.seq - 1 : this.handled;
    const session = this.conn.current;
    if (session.sessionId && durable !== this.durable) {
      this.durable = durable;
      await this.host.storage.put('session', { ...session, seq: durable });
    }
    if (this.lastEventAt) await this.host.storage.put('lastEventAt', this.lastEventAt);
    await this.mirror(false);
    // Out of query budget with events still waiting: the next alarm writes the next share.
    if (this.buffer.length) this.continueSoon();
  }

  /** Asks for an alarm shortly, which runs in a new invocation with a fresh D1 query allowance. */
  private continueSoon(): void {
    this.host.wakeAt(this.host.now() + CONTINUE_MS).catch((error) => this.relay.log.error('gateway.wake_failed', { error }));
  }

  private async afterReady(resumed: boolean): Promise<void> {
    if (resumed) return;
    const since = this.lastEventAt;
    // Anything still buffered belongs to the old session and goes first, so the gap event follows it.
    await this.flush();
    if (!since) return;
    await this.openGap(since, iso(this.relay.now()), null, false);
  }

  /**
   * Remembers where each channel stood, so the messages after that can be fetched, and records a gap per channel (all open
   * ones when `channelIds` is null). With `strict` a gap that can't be recorded is an error, so the caller tries again;
   * otherwise recovering the messages matters more than announcing the gap.
   */
  private async openGap(since: string, until: string, channelIds: string[] | null, strict: boolean): Promise<void> {
    const { results: open } = await this.relay.db.prepare("SELECT id FROM channels WHERE agent_access != 'off'").all<{ id: string }>();
    // Taken before any live event of the new session is written, so the live events can't move the starting point past the gap.
    const { results: cursors } = await this.relay.db
      .prepare('SELECT channel_id, CAST(last_message_id AS TEXT) AS last FROM channel_cursors')
      .all<{ channel_id: string; last: string }>();
    await this.withBackfillLock(async () => {
      const pending = (await this.host.storage.get<Record<string, string>>('backfill')) ?? {};
      for (const c of cursors) {
        pending[c.channel_id] = older(pending[c.channel_id], c.last);
        // A run in progress writes the key again when it ends, from what it read when it began. Telling it what was
        // added here keeps its write from undoing this one.
        if (this.backfilling) this.added.set(c.channel_id, older(this.added.get(c.channel_id), c.last));
      }
      await this.host.storage.put('backfill', pending);
      this.pendingBackfill = true;
    });
    try {
      await recordGap(this.relay, { channelIds: channelIds ?? open.map((c) => c.id), windowStart: since, windowEnd: until, reason: GAP_REASON });
    } catch (error) {
      if (strict) throw error;
      this.relay.log.error('gateway.gap_not_recorded', { error });
    }
    void this.runBackfill();
  }

  /** Looks at channels and threads the relay has never seen a message from, once each, so the mirror isn't empty. */
  private async seed(): Promise<void> {
    if (this.seeding) return;
    this.seeding = true;
    this.seedWanted = false;
    this.lastSeedCheck = this.host.now();
    let again: number | null = null;
    try {
      const r = await seedHistory(this.relay, SEED_PLACES);
      if (r.places) this.relay.log.info('gateway.seeded', { places: r.places, messages: r.messages });
      if (r.more) {
        this.seedWanted = true;
        if (r.retryAfterSeconds !== undefined) again = r.retryAfterSeconds * 1000;
        else this.continueSoon();
      }
    } catch (error) {
      this.relay.log.error('gateway.seed_failed', { error });
    } finally {
      this.seeding = false;
    }
    if (again !== null) this.cancelSeed = this.host.setTimer(() => void this.seed(), again);
  }

  /** The 'backfill' key is read, changed and written here and in runBackfill, so those steps take turns. */
  private withBackfillLock<T>(work: () => Promise<T>): Promise<T> {
    const result = this.backfillLock.then(work);
    this.backfillLock = result.catch(() => {});
    return result;
  }

  private async runBackfill(): Promise<void> {
    if (this.backfilling) return;
    this.backfilling = true;
    let waitMs: number | null = null;
    let carryOn = false;
    try {
      const from = await this.withBackfillLock(async () => {
        this.added.clear();
        const stored = (await this.host.storage.get<Record<string, string>>('backfill')) ?? {};
        if (!Object.keys(stored).length) {
          this.pendingBackfill = false;
          await this.host.storage.delete('backfill');
        }
        return stored;
      });
      if (!Object.keys(from).length) return;
      const budget = metered(this.relay);
      const r = await backfill(budget.relay, from, BACKFILL_PAGES, () => !budget.room());
      this.relay.log.info('gateway.backfill', { pages: r.pages, messages: r.messages, places_left: Object.keys(r.remaining).length, queries: budget.spent });
      // What a gap opened during the run stored is added back, so only places the run finished (and nobody re-added) go.
      const left = await this.withBackfillLock(async () => {
        const rest = { ...r.remaining };
        for (const [id, cursor] of this.added) rest[id] = older(rest[id], cursor);
        this.added.clear();
        if (Object.keys(rest).length) {
          await this.host.storage.put('backfill', rest);
        } else {
          this.pendingBackfill = false;
          await this.host.storage.delete('backfill');
        }
        this.backfilling = false;
        return Object.keys(rest).length;
      });
      // Rate limited: wait as long as Discord says. Otherwise the query budget or the page cap ended the run: next alarm.
      if (left) {
        if (r.retryAfterSeconds !== undefined) waitMs = r.retryAfterSeconds * 1000;
        else carryOn = true;
      }
    } catch (error) {
      this.relay.log.error('gateway.backfill_failed', { error });
      waitMs = 60_000;
    } finally {
      this.backfilling = false;
    }
    if (waitMs !== null) this.cancelBackfill = this.host.setTimer(() => void this.runBackfill(), waitMs);
    else if (carryOn) this.continueSoon();
  }

  private async mirror(force: boolean): Promise<void> {
    const now = this.host.now();
    if (!force && now - this.lastMirror < MIRROR_MS) return;
    this.lastMirror = now;
    const session = this.conn.current;
    try {
      await saveIntakeState(this.relay, {
        status: this.status,
        session_id: session.sessionId,
        seq: this.durable,
        resume_url: session.resumeUrl,
        last_event_at: this.lastEventAt,
        last_heartbeat_at: this.lastHeartbeatAt,
        last_error: this.lastError,
      });
    } catch (error) {
      this.relay.log.error('gateway.mirror_failed', { error });
    }
  }
}
