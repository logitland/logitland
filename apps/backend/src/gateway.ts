import { DurableObject } from 'cloudflare:workers';
import {
  GatewayService,
  consoleLogger,
  createRelay,
  type GatewayClient,
  type GatewayHost,
  type GatewaySocket,
  type Relay,
  type RelayBindings,
  type SocketEvents,
} from '@logitland/relay';
import type { Bindings } from './index';
import { reportError } from './sentry';
import { showcaseHub } from './showcase';
import { streamHub } from './stream';

// The Discord Gateway client. One instance, named "discord".
// This class only owns the outbound WebSocket, the timers and the storage; what to do with them is
// GatewayService (packages/relay/src/gateway), which runs the same way in Node tests.

const log = consoleLogger({ service: 'relay', component: 'gateway' }, reportError);

/**
 * An outbound WebSocket is a fetch with `Upgrade: websocket` to the https form of the URL. Outbound sockets don't hibernate.
 * The Gateway object holds the relay's own; the relay also connects an agent's bot once with it (services/bots.ts).
 */
export async function openSocket(url: string, events: SocketEvents): Promise<GatewaySocket> {
  const response = await fetch(url.replace(/^ws/, 'http'), { headers: { Upgrade: 'websocket' } });
  const ws = response.webSocket;
  if (!ws) throw new Error(`Discord did not accept the WebSocket upgrade (HTTP ${response.status})`);
  ws.accept();
  ws.addEventListener('message', (event) => events.message(event.data as string | ArrayBuffer));
  ws.addEventListener('close', (event) => events.close(event.code, event.reason));
  ws.addEventListener('error', () => events.close(1006, 'connection error'));
  return { send: (data) => ws.send(data), close: (code, reason) => ws.close(code, reason) };
}

export class DiscordGateway extends DurableObject<Bindings> {
  private service: GatewayService | undefined;

  /** Connects if not connected. Cron calls this every minute; the alarm does the same between calls. */
  async ensure(): Promise<void> {
    await this.gateway().ensure();
  }

  async status(): Promise<Record<string, unknown>> {
    return this.gateway().report();
  }

  // The alarm is the backstop: it brings an evicted Durable Object back, and it re-checks a live one.
  override async alarm(): Promise<void> {
    await this.gateway().tick();
  }

  protected buildRelay(): Relay {
    // Events it records wake the agents' streams and reach the home page's live feed.
    return createRelay(this.env as unknown as RelayBindings, {
      streams: streamHub(this.env.AGENT_STREAM),
      showcase: showcaseHub(this.env.SHOWCASE_LIVE),
      log,
    });
  }

  protected openSocket(url: string, events: SocketEvents): Promise<GatewaySocket> {
    return openSocket(url, events);
  }

  protected gateway(): GatewayService {
    this.service ??= new GatewayService(this.host());
    return this.service;
  }

  private host(): GatewayHost {
    return {
      relay: this.buildRelay(),
      token: this.env.DISCORD_BOT_TOKEN ?? '',
      storage: this.ctx.storage,
      connect: (url, events) => this.openSocket(url, events),
      setTimer: (fn, ms) => {
        const timer = setTimeout(fn, ms);
        return () => clearTimeout(timer);
      },
      wakeAt: (epochMs) => this.ctx.storage.setAlarm(epochMs),
      now: () => Date.now(),
      random: () => Math.random(),
    };
  }
}

export function gatewayClient(ns: DurableObjectNamespace<DiscordGateway>): GatewayClient {
  const stub = () => ns.get(ns.idFromName('discord'));
  return {
    ensure: () => stub().ensure(),
    status: () => stub().status(),
  };
}
