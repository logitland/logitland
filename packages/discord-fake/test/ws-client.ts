// A raw WebSocket client for tests, independent of the server's framing code: it opens the HTTP upgrade itself,
// masks what it sends and decodes what it receives, so the fake's implementation is checked against RFC 6455
// rather than against itself.

import { createHash, randomBytes } from 'node:crypto';
import { request } from 'node:http';
import type { Duplex } from 'node:stream';

export interface ReceivedFrame {
  fin: boolean;
  opcode: number;
  data: Buffer;
}

const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

export class RawClient {
  readonly frames: ReceivedFrame[] = [];
  closed: { code: number; reason: string } | null = null;
  ended = false;
  private closeSent = false;
  private buffer = Buffer.alloc(0);
  private waiting: (() => void)[] = [];
  readonly socket: Duplex;
  acceptHeader = '';

  private constructor(socket: Duplex) {
    this.socket = socket;
    socket.on('data', (chunk: Buffer) => this.receive(chunk));
    socket.on('close', () => {
      this.ended = true;
      this.wake();
    });
    socket.on('error', () => {});
  }

  /** Opens the upgrade. Rejects with the HTTP status when the server refuses. */
  static async connect(url: string, opts: { key?: string } = {}): Promise<RawClient> {
    const key = opts.key ?? randomBytes(16).toString('base64');
    const u = new URL(url.replace(/^ws/, 'http'));
    return new Promise((resolve, reject) => {
      const req = request({
        host: u.hostname,
        port: u.port,
        path: u.pathname + u.search,
        headers: { Connection: 'Upgrade', Upgrade: 'websocket', 'Sec-WebSocket-Key': key, 'Sec-WebSocket-Version': '13' },
      });
      req.on('upgrade', (res, socket, head) => {
        const expected = createHash('sha1')
          .update(key + GUID)
          .digest('base64');
        if (res.headers['sec-websocket-accept'] !== expected) return reject(new Error(`Bad Sec-WebSocket-Accept: ${res.headers['sec-websocket-accept']}`));
        const client = new RawClient(socket);
        client.acceptHeader = String(res.headers['sec-websocket-accept']);
        if (head.length) client.receive(head);
        resolve(client);
      });
      req.on('response', (res) => reject(new Error(`HTTP ${res.statusCode}`)));
      req.on('error', reject);
      req.end();
    });
  }

  private wake(): void {
    for (const w of this.waiting.splice(0)) w();
  }

  private receive(chunk: Buffer): void {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    for (;;) {
      const b = this.buffer;
      if (b.length < 2) return;
      const fin = (b[0]! & 0x80) !== 0;
      const opcode = b[0]! & 0x0f;
      if ((b[1]! & 0x80) !== 0) throw new Error('The server must not mask frames');
      let length = b[1]! & 0x7f;
      let offset = 2;
      if (length === 126) {
        if (b.length < 4) return;
        length = b.readUInt16BE(2);
        offset = 4;
      } else if (length === 127) {
        if (b.length < 10) return;
        length = Number(b.readBigUInt64BE(2));
        offset = 10;
      }
      if (b.length < offset + length) return;
      const data = Buffer.from(b.subarray(offset, offset + length));
      this.buffer = b.subarray(offset + length);
      if (opcode === 0x8) {
        this.closed = { code: data.length >= 2 ? data.readUInt16BE(0) : 1005, reason: data.subarray(2).toString('utf8') };
        // A well-behaved client answers a close with a close.
        if (!this.closeSent) this.close(this.closed.code);
      }
      this.frames.push({ fin, opcode, data });
      this.wake();
    }
  }

  /** Writes one frame, masked as a client must. */
  sendFrame(opcode: number, payload: Buffer, opts: { fin?: boolean; mask?: boolean } = {}): void {
    const masked = opts.mask !== false;
    const n = payload.length;
    const head = n < 126 ? Buffer.alloc(2) : n < 65_536 ? Buffer.alloc(4) : Buffer.alloc(10);
    head[0] = (opts.fin === false ? 0 : 0x80) | opcode;
    const flag = masked ? 0x80 : 0;
    if (n < 126) head[1] = flag | n;
    else if (n < 65_536) {
      head[1] = flag | 126;
      head.writeUInt16BE(n, 2);
    } else {
      head[1] = flag | 127;
      head.writeBigUInt64BE(BigInt(n), 2);
    }
    if (!masked) return void this.socket.write(Buffer.concat([head, payload]));
    const mask = randomBytes(4);
    const body = Buffer.from(payload);
    for (let i = 0; i < body.length; i++) body[i] = body[i]! ^ mask[i % 4]!;
    this.socket.write(Buffer.concat([head, mask, body]));
  }

  sendText(text: string, opts?: { fin?: boolean; mask?: boolean }): void {
    this.sendFrame(0x1, Buffer.from(text, 'utf8'), opts);
  }

  send(frame: unknown): void {
    this.sendText(JSON.stringify(frame));
  }

  ping(data = Buffer.from('ping')): void {
    this.sendFrame(0x9, data);
  }

  close(code = 1000, reason = ''): void {
    this.closeSent = true;
    const body = Buffer.alloc(2 + Buffer.byteLength(reason));
    body.writeUInt16BE(code, 0);
    body.write(reason, 2);
    this.sendFrame(0x8, body);
  }

  /** Drops the TCP connection without a close frame. */
  kill(): void {
    this.socket.destroy();
  }

  async next(timeoutMs = 3000): Promise<ReceivedFrame> {
    const deadline = Date.now() + timeoutMs;
    while (!this.frames.length) {
      if (this.ended) throw new Error('The connection ended');
      const left = deadline - Date.now();
      if (left <= 0) throw new Error('Timed out waiting for a frame');
      await new Promise<void>((resolve) => {
        const t = setTimeout(resolve, left);
        this.waiting.push(() => {
          clearTimeout(t);
          resolve();
        });
      });
    }
    return this.frames.shift()!;
  }

  /** The next text frame, parsed. Skips nothing: pings, pongs and closes come back as errors. */
  async nextJson(timeoutMs?: number): Promise<{ op: number; d: any; s: number | null; t: string | null }> {
    const f = await this.next(timeoutMs);
    if (f.opcode !== 0x1) throw new Error(`Expected a text frame, got opcode ${f.opcode}`);
    return JSON.parse(f.data.toString('utf8'));
  }

  /** Reads dispatches until one named `t` arrives; returns everything read, the match last. */
  async until(t: string, timeoutMs = 3000): Promise<{ op: number; d: any; s: number | null; t: string | null }[]> {
    const seen = [];
    for (;;) {
      const f = await this.nextJson(timeoutMs);
      seen.push(f);
      if (f.t === t) return seen;
    }
  }

  /** Waits for the connection to end and returns the close code the server sent, or 1006. */
  async waitClose(timeoutMs = 3000): Promise<number> {
    const deadline = Date.now() + timeoutMs;
    while (!this.ended) {
      if (Date.now() > deadline) throw new Error('Timed out waiting for the connection to close');
      await new Promise<void>((resolve) => {
        const t = setTimeout(resolve, 20);
        this.waiting.push(() => {
          clearTimeout(t);
          resolve();
        });
      });
    }
    return this.closed?.code ?? 1006;
  }
}
