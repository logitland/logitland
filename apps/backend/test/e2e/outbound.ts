// Everything the Worker sends to the internet goes through here, so the suite can never reach the real Discord
// (or anything else). Requests to loopback pass through to the fake, WebSocket upgrades are bridged to the fake's
// Gateway, requests to Discord's own hosts are rewritten to land on the fake (the relay's interaction follow-ups use
// a fixed https://discord.com address), and anything else is refused and recorded.
//
// wrangler's `dev.outboundService` hook is a function that runs in Node. A function can't answer a WebSocket upgrade
// unless it returns miniflare's own Response with a WebSocketPair end, so those two classes are taken from the
// miniflare that wrangler itself depends on.

import { createRequire } from 'node:module';
import type { DiscordFake } from '../../../../packages/discord-fake/src/index.ts';

interface MiniflareSocket {
  accept(): void;
  send(data: string | ArrayBuffer): void;
  close(code?: number, reason?: string): void;
  addEventListener(type: 'message' | 'close' | 'error', listener: (event: { data?: string | ArrayBuffer; code?: number; reason?: string }) => void): void;
}

interface Miniflare {
  WebSocketPair: new () => Record<'0' | '1', MiniflareSocket>;
  Response: new (body: null, init: { status: number; webSocket: MiniflareSocket }) => Response;
}

const DISCORD_HOST = /(^|\.)discord(app)?\.com$/;
const LOCAL_HOST = /^(127\.0\.0\.1|localhost|\[::1\])$/;
/** Close codes a WebSocket may send: 1005, 1006 and 1015 are reserved for reporting, not sending. */
const sendable = (code: number | undefined): code is number => code === 1000 || (code !== undefined && code >= 3000 && code <= 4999);

export interface Outbound {
  handler(request: Request): Promise<Response>;
  /** Requests that were refused, as "METHOD url". The suite fails if this isn't empty. */
  blocked: string[];
  /** Requests to Discord's hosts that were sent to the fake instead, as "METHOD path". */
  redirected: string[];
  /** Gateway connections opened so far. */
  sockets: number;
  closeAll(): void;
}

export function outbound(fake: DiscordFake): Outbound {
  const mini = createRequire(createRequire(import.meta.url).resolve('wrangler'))('miniflare') as Miniflare;
  const blocked: string[] = [];
  const redirected: string[] = [];
  const open = new Set<WebSocket>();
  const state = { sockets: 0 };

  async function bridge(url: URL): Promise<Response> {
    const upstream = new WebSocket(url.toString().replace(/^http/, 'ws'));
    upstream.binaryType = 'arraybuffer';
    await new Promise<void>((resolve, reject) => {
      upstream.addEventListener('open', () => resolve(), { once: true });
      upstream.addEventListener('error', () => reject(new Error(`The fake Gateway refused the connection at ${url.host}`)), { once: true });
    });
    const pair = new mini.WebSocketPair();
    const [client, server] = [pair['0'], pair['1']];
    server.accept();
    open.add(upstream);
    state.sockets++;
    upstream.addEventListener('message', (e) => server.send(e.data as string | ArrayBuffer));
    upstream.addEventListener('close', (e) => {
      open.delete(upstream);
      if (sendable(e.code)) server.close(e.code, e.reason);
      else server.close();
    });
    server.addEventListener('message', (e) => upstream.send(e.data as string));
    server.addEventListener('close', (e) => (sendable(e.code) ? upstream.close(e.code, e.reason) : upstream.close()));
    server.addEventListener('error', () => upstream.close());
    return new mini.Response(null, { status: 101, webSocket: client });
  }

  async function handler(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const label = `${request.method} ${url.origin}${url.pathname}`;
    let target: URL;
    if (LOCAL_HOST.test(url.hostname)) target = url;
    else if (DISCORD_HOST.test(url.hostname)) {
      redirected.push(`${request.method} ${url.pathname}`);
      target = new URL(`${fake.url}${url.pathname}${url.search}`);
    } else {
      blocked.push(label);
      return new Response(`The e2e suite doesn’t allow requests to ${url.host}`, { status: 599 });
    }
    if (request.headers.get('upgrade')?.toLowerCase() === 'websocket') return bridge(target);
    const headers = new Headers(request.headers);
    headers.delete('host');
    const body = request.method === 'GET' || request.method === 'HEAD' ? undefined : await request.arrayBuffer();
    return fetch(target, { method: request.method, headers, body, redirect: 'manual' });
  }

  return {
    handler,
    blocked,
    redirected,
    get sockets() {
      return state.sockets;
    },
    closeAll() {
      for (const s of open) s.close();
    },
  };
}
