import { DurableObject } from 'cloudflare:workers';
import { consoleLogger, createRelay, setStreamSockets, streamTake, type Relay, type RelayBindings, type StreamHub } from '@logitland/relay';
import type { Bindings } from './index';

// One Durable Object per agent holds its WebSocket streams (#11), with the Hibernation API, so an idle socket costs
// nothing while it waits. The relay decides what to send (streamTake); this object only holds the sockets, sends the
// frames to each, and sets an alarm for the next subscription due. Frames are at most once: a digest taken while a
// socket drops is gone from the stream, and GET /v1/subscriptions/:id/events?after= reads it again.

const log = consoleLogger({ service: 'relay', component: 'stream' });
const AGENT_KEY = 'agent';
/** Set by the hub only: the agent the authenticated /v1/stream request is for. */
const AGENT_HEADER = 'x-logitland-agent';
/** Sockets one agent may hold open at once. */
const MAX_SOCKETS = 5;

export class AgentStream extends DurableObject<Bindings> {
  private relayInstance: Relay | undefined;

  constructor(ctx: DurableObjectState, env: Bindings) {
    super(ctx, env);
    // Answered without waking the object, so keepalives cost nothing.
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong'));
  }

  private get relay(): Relay {
    return (this.relayInstance ??= createRelay(this.env as unknown as RelayBindings, { log }));
  }

  private open(): WebSocket[] {
    return this.ctx.getWebSockets().filter((ws) => ws.readyState === WebSocket.OPEN);
  }

  /** The upgrade, already authenticated by /v1/stream. */
  override async fetch(request: Request): Promise<Response> {
    const agentId = request.headers.get(AGENT_HEADER);
    if (!agentId) return new Response(null, { status: 400 });
    if (this.open().length >= MAX_SOCKETS)
      return Response.json(
        { type: 'about:blank', title: 'Too many streams', status: 429, code: 'rate_limited', detail: `An agent may hold ${MAX_SOCKETS} streams open at once.` },
        { status: 429, headers: { 'content-type': 'application/problem+json' } },
      );
    const { 0: client, 1: server } = new WebSocketPair();
    this.ctx.acceptWebSocket(server);
    await this.ctx.storage.put(AGENT_KEY, agentId);
    await setStreamSockets(this.relay, agentId, this.open().length);
    // What is already due goes out as soon as the socket is open.
    this.ctx.waitUntil(this.send());
    return new Response(null, { status: 101, webSocket: client });
  }

  /** Subscriptions fell due: send them. */
  async notify(): Promise<void> {
    await this.send();
  }

  override async alarm(): Promise<void> {
    await this.send();
  }

  override async webSocketMessage(): Promise<void> {
    // Agents have nothing to say on a stream; "ping" is answered automatically.
  }

  override async webSocketClose(ws: WebSocket, code: number): Promise<void> {
    ws.close(code === 1005 ? 1000 : code);
    await this.recount();
  }

  override async webSocketError(): Promise<void> {
    await this.recount();
  }

  private async recount(): Promise<void> {
    const agentId = await this.ctx.storage.get<string>(AGENT_KEY);
    if (agentId) await setStreamSockets(this.relay, agentId, this.open().length);
  }

  private async send(): Promise<void> {
    const agentId = await this.ctx.storage.get<string>(AGENT_KEY);
    const sockets = this.open();
    if (!agentId || !sockets.length) return;
    const take = await streamTake(this.relay, agentId);
    if ('close' in take) {
      for (const ws of sockets) ws.close(take.close.code, take.close.reason);
      await setStreamSockets(this.relay, agentId, 0);
      return;
    }
    for (const frame of take.frames)
      for (const ws of sockets) {
        try {
          ws.send(frame);
        } catch (error) {
          log.warn('stream.send_failed', { agent_id: agentId, error });
        }
      }
    if (take.nextDueMs !== null) await this.ctx.storage.setAlarm(Math.max(take.nextDueMs, Date.now()));
  }
}

export function streamHub(ns: DurableObjectNamespace<AgentStream>): StreamHub {
  return {
    connect: (agentId, request) => {
      const headers = new Headers(request.headers);
      headers.set(AGENT_HEADER, agentId);
      return ns.get(ns.idFromName(agentId)).fetch(new Request(request.url, { headers }));
    },
    notify: (agentId) => ns.get(ns.idFromName(agentId)).notify(),
  };
}
