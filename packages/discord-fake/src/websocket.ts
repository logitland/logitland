// A server-side WebSocket (RFC 6455), written by hand so the fake needs no dependencies: the HTTP upgrade with
// Sec-WebSocket-Accept, text and binary messages (with fragmentation), ping and pong, and close frames.
// Clients must mask their frames; the server never does. https://www.rfc-editor.org/rfc/rfc6455

import { createHash } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';

const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
const MAX_MESSAGE = 4 * 1024 * 1024;

const Opcode = { continuation: 0x0, text: 0x1, binary: 0x2, close: 0x8, ping: 0x9, pong: 0xa } as const;

export const acceptKey = (clientKey: string): string =>
  createHash('sha1')
    .update(clientKey + GUID)
    .digest('base64');

/** Frames one server-to-client message: FIN set, unmasked. */
export function encodeFrame(opcode: number, payload: Buffer): Buffer {
  const n = payload.length;
  const head = n < 126 ? Buffer.alloc(2) : n < 65_536 ? Buffer.alloc(4) : Buffer.alloc(10);
  head[0] = 0x80 | opcode;
  if (n < 126) head[1] = n;
  else if (n < 65_536) {
    head[1] = 126;
    head.writeUInt16BE(n, 2);
  } else {
    head[1] = 127;
    head.writeBigUInt64BE(BigInt(n), 2);
  }
  return Buffer.concat([head, payload]);
}

export function closePayload(code: number, reason = ''): Buffer {
  const reasonBytes = Buffer.from(reason.slice(0, 120), 'utf8');
  const out = Buffer.alloc(2 + reasonBytes.length);
  out.writeUInt16BE(code, 0);
  reasonBytes.copy(out, 2);
  return out;
}

export class WebSocketConnection {
  onText: (text: string) => void = () => {};
  onBinary: (data: Buffer) => void = () => {};
  onPing: (data: Buffer) => void = () => {};
  onPong: (data: Buffer) => void = () => {};
  /** Called once. `code` is 1006 when the socket went away without a close frame. */
  onClose: (code: number, reason: string) => void = () => {};
  /** Set to false to stop answering pings (a socket that is up but unresponsive). */
  autoPong = true;

  readonly socket: Duplex;
  private buffer: Buffer = Buffer.alloc(0);
  private fragments: Buffer[] = [];
  private fragmentKind: number = 0;
  private fragmentBytes = 0;
  private closeSent = false;
  private closeReceived = false;
  private finished = false;
  private closeTimer: NodeJS.Timeout | null = null;
  /** The code the connection ended with: ours when we closed it, the peer's when it did. */
  private pendingClose: { code: number; reason: string } | null = null;

  constructor(socket: Duplex, head: Buffer = Buffer.alloc(0)) {
    this.socket = socket;
    socket.on('data', (chunk: Buffer) => this.receive(chunk));
    // The HTTP server keeps sockets half-open, so a peer that hangs up has to be answered for 'close' to follow.
    socket.on('end', () => socket.end());
    socket.on('close', () => this.finish(1006, ''));
    socket.on('error', () => socket.destroy());
    if (head.length) this.receive(head);
  }

  get open(): boolean {
    return !this.closeSent && !this.finished && !this.socket.destroyed;
  }

  sendText(text: string): void {
    if (this.open) this.socket.write(encodeFrame(Opcode.text, Buffer.from(text, 'utf8')));
  }

  sendBinary(data: Buffer): void {
    if (this.open) this.socket.write(encodeFrame(Opcode.binary, data));
  }

  ping(data: Buffer = Buffer.alloc(0)): void {
    if (this.open) this.socket.write(encodeFrame(Opcode.ping, data));
  }

  /** Sends a close frame, then waits briefly for the peer's before dropping the socket. */
  close(code = 1000, reason = ''): void {
    if (this.closeSent || this.finished) return;
    this.closeSent = true;
    this.pendingClose ??= { code, reason };
    if (!this.socket.destroyed) this.socket.write(encodeFrame(Opcode.close, closePayload(code, reason)));
    this.closeTimer = setTimeout(() => this.socket.destroy(), 1000);
    this.closeTimer.unref();
    if (this.closeReceived) this.socket.end();
  }

  /** Drops the connection with no close frame, like a network failure. */
  terminate(): void {
    this.socket.destroy();
  }

  private finish(code: number, reason: string): void {
    if (this.finished) return;
    this.finished = true;
    if (this.closeTimer) clearTimeout(this.closeTimer);
    this.onClose(this.pendingClose?.code ?? code, this.pendingClose?.reason ?? reason);
  }

  private fail(code: number, reason: string): void {
    this.pendingClose = { code, reason };
    this.close(code, reason);
  }

  private receive(chunk: Buffer): void {
    this.buffer = this.buffer.length ? Buffer.concat([this.buffer, chunk]) : chunk;
    for (;;) {
      const buf = this.buffer;
      if (buf.length < 2) return;
      const fin = (buf[0]! & 0x80) !== 0;
      const rsv = buf[0]! & 0x70;
      const opcode = buf[0]! & 0x0f;
      const masked = (buf[1]! & 0x80) !== 0;
      let length = buf[1]! & 0x7f;
      let offset = 2;
      if (length === 126) {
        if (buf.length < 4) return;
        length = buf.readUInt16BE(2);
        offset = 4;
      } else if (length === 127) {
        if (buf.length < 10) return;
        const big = buf.readBigUInt64BE(2);
        if (big > BigInt(MAX_MESSAGE)) return this.fail(1009, 'message too big');
        length = Number(big);
        offset = 10;
      }
      if (rsv !== 0) return this.fail(1002, 'reserved bits set');
      if (!masked) return this.fail(1002, 'client frames must be masked');
      const isControl = opcode >= 0x8;
      if (isControl && (!fin || length > 125)) return this.fail(1002, 'bad control frame');
      if (length > MAX_MESSAGE) return this.fail(1009, 'message too big');
      const total = offset + 4 + length;
      if (buf.length < total) return;
      const mask = buf.subarray(offset, offset + 4);
      const payload = Buffer.from(buf.subarray(offset + 4, total));
      for (let i = 0; i < payload.length; i++) payload[i] = payload[i]! ^ mask[i % 4]!;
      this.buffer = buf.subarray(total);
      if (!this.frame(fin, opcode, payload)) return;
    }
  }

  /** Returns false when the connection is being torn down and no more input should be read. */
  private frame(fin: boolean, opcode: number, payload: Buffer): boolean {
    switch (opcode) {
      case Opcode.ping:
        this.onPing(payload);
        if (this.autoPong && this.open) this.socket.write(encodeFrame(Opcode.pong, payload));
        return true;
      case Opcode.pong:
        this.onPong(payload);
        return true;
      case Opcode.close: {
        if (payload.length === 1) {
          this.fail(1002, 'bad close frame');
          return false;
        }
        const code = payload.length >= 2 ? payload.readUInt16BE(0) : 1005;
        const reason = payload.length > 2 ? payload.subarray(2).toString('utf8') : '';
        this.closeReceived = true;
        this.pendingClose ??= { code, reason };
        if (!this.closeSent) this.close(code === 1005 ? 1000 : code, '');
        this.socket.end();
        return false;
      }
      case Opcode.text:
      case Opcode.binary:
        if (this.fragmentKind !== 0) {
          this.fail(1002, 'new message inside a fragmented one');
          return false;
        }
        if (fin) return this.deliver(opcode, payload);
        this.fragmentKind = opcode;
        this.fragments = [payload];
        this.fragmentBytes = payload.length;
        return true;
      case Opcode.continuation: {
        if (this.fragmentKind === 0) {
          this.fail(1002, 'continuation without a message');
          return false;
        }
        this.fragments.push(payload);
        this.fragmentBytes += payload.length;
        if (this.fragmentBytes > MAX_MESSAGE) {
          this.fail(1009, 'message too big');
          return false;
        }
        if (!fin) return true;
        const kind = this.fragmentKind;
        const whole = Buffer.concat(this.fragments);
        this.fragmentKind = 0;
        this.fragments = [];
        return this.deliver(kind, whole);
      }
      default:
        this.fail(1002, 'unknown opcode');
        return false;
    }
  }

  private deliver(opcode: number, data: Buffer): boolean {
    if (opcode === Opcode.binary) {
      this.onBinary(data);
      return true;
    }
    let text: string;
    try {
      text = new TextDecoder('utf-8', { fatal: true }).decode(data);
    } catch {
      this.fail(1007, 'invalid UTF-8');
      return false;
    }
    this.onText(text);
    return true;
  }
}

/**
 * Completes the upgrade handshake and returns the connection, or answers 400 and returns null.
 * `head` is whatever bytes followed the HTTP request on the socket.
 */
export function acceptUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer): WebSocketConnection | null {
  const key = req.headers['sec-websocket-key'];
  const upgrade = String(req.headers.upgrade ?? '').toLowerCase();
  const connection = String(req.headers.connection ?? '').toLowerCase();
  if (upgrade !== 'websocket' || !connection.includes('upgrade') || typeof key !== 'string' || req.headers['sec-websocket-version'] !== '13') {
    socket.end('HTTP/1.1 400 Bad Request\r\nconnection: close\r\ncontent-length: 0\r\n\r\n');
    return null;
  }
  socket.write(
    ['HTTP/1.1 101 Switching Protocols', 'Upgrade: websocket', 'Connection: Upgrade', `Sec-WebSocket-Accept: ${acceptKey(key)}`, '', ''].join('\r\n'),
  );
  return new WebSocketConnection(socket, head);
}
