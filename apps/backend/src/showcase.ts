import type { ShowcaseFrame } from '@logitland/contracts';
import { DurableObject } from 'cloudflare:workers';
import type { ShowcaseHub } from '@logitland/relay';
import type { Bindings } from './index';

// The home page's live feed (#28): one Durable Object holds every visitor's WebSocket, with the Hibernation API, so idle
// sockets cost nothing while they wait. The relay decides what to send (publishShowcase, after each commit); this object
// fans the frames out, and keeps what it deleted from coming back. Visitors say nothing: "ping" is answered without waking
// it, anything else closes the socket.

/** Set by the hub only: who the /v1/showcase/live request came from, a hash of their address. */
const VISITOR_HEADER = 'x-logitland-visitor';
/** Sockets one address may hold open at once: a few tabs, or a few people behind one network. */
const MAX_PER_VISITOR = 8;
/** Sockets the feed holds at once, well inside what one Durable Object can. */
const MAX_SOCKETS = 10_000;
/** WebSocket close code for a visitor who sent something other than "ping" (1008, policy violation). */
const CLOSE_SPOKE = 1008;
/** How long the feed remembers a deleted message: far longer than any publication can be in flight. */
const REMEMBER_GONE_MS = 60 * 60_000;

const tooMany = (detail: string) =>
  Response.json(
    { type: 'about:blank', title: 'Too many connections', status: 429, code: 'rate_limited', detail },
    { status: 429, headers: { 'content-type': 'application/problem+json' } },
  );

export class ShowcaseLive extends DurableObject<Bindings> {
  constructor(ctx: DurableObjectState, env: Bindings) {
    super(ctx, env);
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong'));
  }

  /** The upgrade, from /v1/showcase/live. Each socket is tagged with its visitor, so they're counted per address. */
  override async fetch(request: Request): Promise<Response> {
    const visitor = request.headers.get(VISITOR_HEADER);
    if (!visitor) return new Response(null, { status: 400 });
    if (this.ctx.getWebSockets(visitor).length >= MAX_PER_VISITOR) return tooMany(`An address may hold ${MAX_PER_VISITOR} live feeds open at once.`);
    if (this.ctx.getWebSockets().length >= MAX_SOCKETS) return tooMany('The live feed is full. Reload the page to see what’s new.');
    const { 0: client, 1: server } = new WebSocketPair();
    this.ctx.acceptWebSocket(server, [visitor]);
    return new Response(null, { status: 101, webSocket: client });
  }

  /**
   * Sends the frames to every open socket. A publication reads its messages before it sends them, so one still in flight when
   * a message is removed could send it again after its deletion; the feed remembers what it deleted and drops those.
   */
  async publish(frames: ShowcaseFrame[]): Promise<void> {
    const gone = this.ctx.storage.kv;
    const now = Date.now();
    for (const [id, at] of gone.list<number>()) if (at < now - REMEMBER_GONE_MS) gone.delete(id);
    const sent: string[] = [];
    for (const frame of frames) {
      // A post still showing a starter that was deleted is from before the deletion; one read since shows it deleted.
      // `post.removed` alone is no deletion: a post can be unlisted for a moment (its starter recorded before its thread).
      if (frame.type === 'message.deleted') for (const id of frame.message_ids) gone.put(id, now);
      else if (frame.type === 'message.created' || frame.type === 'message.updated') {
        if (gone.get(frame.message.message_id) !== undefined) continue;
      } else if (frame.type === 'post.updated') {
        const { starter } = frame.post;
        if (starter && !starter.deleted && gone.get(starter.message_id) !== undefined) continue;
      }
      sent.push(JSON.stringify(frame));
    }
    if (!sent.length) return;
    for (const ws of this.ctx.getWebSockets()) {
      if (ws.readyState !== WebSocket.OPEN) continue;
      try {
        for (const frame of sent) ws.send(frame);
      } catch {
        // Closing as we sent: its close handler tidies up.
      }
    }
  }

  override async webSocketMessage(ws: WebSocket): Promise<void> {
    ws.close(CLOSE_SPOKE, 'This feed only sends.');
  }

  override async webSocketClose(ws: WebSocket, code: number): Promise<void> {
    ws.close(code === 1005 ? 1000 : code);
  }
}

/** The one feed, as the relay reaches it. */
export function showcaseHub(ns: DurableObjectNamespace<ShowcaseLive>): ShowcaseHub {
  const feed = () => ns.get(ns.idFromName('home'));
  return {
    connect: (request, visitor) => {
      const headers = new Headers(request.headers);
      headers.set(VISITOR_HEADER, visitor);
      return feed().fetch(new Request(request.url, { headers }));
    },
    publish: (frames) => feed().publish(frames),
  };
}
