import { DurableObject } from 'cloudflare:workers';
import { consoleLogger, createRelay, processSend, type ChannelSenderClient, type Relay, type RelayBindings } from '@logitland/relay';
import type { Bindings } from './index';
import { reportError } from './sentry';
import { streamHub } from './stream';

// One send queue per channel, so agents share Discord's per-webhook limits politely instead of failing on 429.
// The queue lives in the Durable Object's storage and is worked off by an alarm, so it survives eviction and restarts.
// D1 holds each message's real state; the queue holds only IDs.
//
// How a request experiences it: when the queue is idle (nothing waiting, no pause owed to Discord) the message is sent
// inside the enqueue call and the caller finds it `sent`; when the queue is busy or paused the caller returns at once,
// finds it `queued`, and the alarm sends it in order.

export interface QueueStorage {
  get<T>(key: string): Promise<T | undefined>;
  put(key: string, value: unknown): Promise<void>;
  setAlarm(scheduledTime: number): Promise<void>;
  getAlarm(): Promise<number | null>;
}

interface State {
  queue: string[];
  /** Epoch ms before which nothing is sent: Discord's rate-limit window, or a short pause after an error. */
  notBefore: number;
  /** The message at the head of the line and how many times in a row processing it has crashed. Kept here, not in memory, so it survives eviction. */
  head?: { id: string; tries: number };
}

const log = consoleLogger({ service: 'relay', component: 'sender' }, reportError);

/** After this many consecutive crashes on one message it leaves the queue; D1 still holds it and the stuck-message sweep deals with it. */
const MAX_TRIES = 5;
/** The line is stored as one value (2 MB at most), so it is kept far below that. */
const MAX_QUEUE = 1000;
/** One alarm works for at most this long, then hands over to the next. */
const ALARM_BUDGET_MS = 20_000;

export class SendQueue {
  private state: State = { queue: [], notBefore: 0 };
  private loading: Promise<void> | null = null;
  private busy = false;

  constructor(
    private readonly storage: QueueStorage,
    private readonly relay: () => Relay,
    private readonly now: () => number = Date.now,
  ) {}

  private load(): Promise<void> {
    // A failed read isn't remembered: the next call tries again instead of failing until the object is evicted.
    return (this.loading ??= this.storage
      .get<State>('state')
      .then((s) => {
        if (s) this.state = s;
      })
      .catch((error) => {
        this.loading = null;
        throw error;
      }));
  }

  private save(): Promise<void> {
    return this.storage.put('state', { queue: [...this.state.queue], notBefore: this.state.notBefore, head: this.state.head });
  }

  async enqueue(messageId: string): Promise<void> {
    await this.load();
    if (!this.state.queue.includes(messageId)) {
      // A line this long means Discord is far behind; the message stays queued in D1 and the stuck-message sweep offers it again.
      if (this.state.queue.length >= MAX_QUEUE) throw new Error('send queue is full');
      // Decided before the first await below, so two requests can't both think the queue is idle.
      const idle = !this.busy && this.state.queue.length === 0 && this.now() >= this.state.notBefore;
      this.state.queue.push(messageId);
      if (idle) this.busy = true;
      try {
        await this.save();
        if (idle) await this.sendHead();
      } finally {
        if (idle) this.busy = false;
      }
    }
    await this.arm();
  }

  /** Works off the queue in order until it is empty, Discord asks for a pause, or the time budget is spent. */
  async alarm(): Promise<void> {
    await this.load();
    if (!this.busy) {
      this.busy = true;
      const deadline = this.now() + ALARM_BUDGET_MS;
      try {
        while (this.state.queue.length > 0 && this.now() >= this.state.notBefore && this.now() < deadline) await this.sendHead();
      } catch (error) {
        // The platform retries a throwing alarm only six times; scheduling the next one ourselves never runs out.
        log.error('sender.alarm_failed', { error });
        this.state.notBefore = Math.max(this.state.notBefore, this.now() + 5_000);
      } finally {
        this.busy = false;
      }
    }
    await this.arm();
  }

  private async sendHead(): Promise<void> {
    const id = this.state.queue[0];
    if (!id) return;
    let result: Awaited<ReturnType<typeof processSend>>;
    try {
      result = await processSend(this.relay(), id);
      this.state.head = undefined;
    } catch (error) {
      const n = (this.state.head?.id === id ? this.state.head.tries : 0) + 1;
      this.state.head = { id, tries: n };
      log.error('sender.crashed', { message_id: id, attempt: n, error });
      if (n < MAX_TRIES) {
        this.state.notBefore = this.now() + 5_000 * n;
        await this.save();
        return;
      }
      this.state.head = undefined;
      result = {};
    }
    if (result.retry) {
      this.state.notBefore = this.now() + (result.retryAfterSeconds ?? 1) * 1000;
    } else {
      this.state.queue.shift();
      if (result.retryAfterSeconds) this.state.notBefore = Math.max(this.state.notBefore, this.now() + result.retryAfterSeconds * 1000);
    }
    await this.save();
  }

  /** Makes sure an alarm will come for whatever is still waiting. */
  private async arm(): Promise<void> {
    if (this.state.queue.length === 0) return;
    const at = Math.max(this.state.notBefore, this.now() + (this.busy ? 1000 : 50));
    const current = await this.storage.getAlarm();
    if (current === null || current > at) await this.storage.setAlarm(at);
  }
}

export class ChannelSender extends DurableObject<Bindings> {
  private readonly queue: SendQueue;

  constructor(ctx: DurableObjectState, env: Bindings) {
    super(ctx, env);
    let relay: Relay | undefined;
    // The queue's own relay never needs a sender or a Gateway client: it only calls processSend. Its status changes wake streams.
    this.queue = new SendQueue(ctx.storage, () => (relay ??= createRelay(env as unknown as RelayBindings, { streams: streamHub(env.AGENT_STREAM), log })));
  }

  /** Adds a queued message to this channel's line. Returns once it is sent (idle queue) or queued behind others. */
  enqueue(messageId: string): Promise<void> {
    return this.queue.enqueue(messageId);
  }

  override async alarm(): Promise<void> {
    await this.queue.alarm();
  }
}

export function senderClient(ns: DurableObjectNamespace<ChannelSender>): ChannelSenderClient {
  return {
    enqueue: (channelId, messageId) => ns.get(ns.idFromName(channelId)).enqueue(messageId),
  };
}
