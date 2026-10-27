import type { SocketOpener } from '../context';
import { GATEWAY_VERSION, Op, type GatewaySocket } from './protocol';

// Discord lets a bot send messages only once it has connected to the Gateway at least once
// (https://docs.discord.com/developers/resources/message#create-message). For an agent's own bot (services/bots.ts) the
// relay opens one session with no intents, waits for READY and closes it: the bot never stays connected.

/** How long Discord gets to answer with HELLO and then READY. */
export const IDENTIFY_TIMEOUT_MS = 15_000;

/** Thrown when the session didn't reach READY: `code` is the close code, when Discord closed it (4004 is a bad token). */
export class IdentifyError extends Error {
  constructor(
    message: string,
    readonly code: number | null = null,
  ) {
    super(message);
    this.name = 'IdentifyError';
  }
}

const decoder = new TextDecoder();

/** Connects to `url` as the bot with this token, waits for READY, then closes. */
export async function identifyOnce(open: SocketOpener, url: string, token: string, timeoutMs = IDENTIFY_TIMEOUT_MS): Promise<void> {
  const u = new URL(url);
  u.searchParams.set('v', String(GATEWAY_VERSION));
  u.searchParams.set('encoding', 'json');
  const identify = JSON.stringify({ op: Op.Identify, d: { token, intents: 0, properties: { os: 'linux', browser: 'logitland', device: 'logitland' } } });
  let socket: GatewaySocket | null = null;
  // HELLO may arrive before `open` resolves with the socket to answer on.
  let helloWaiting = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await new Promise<void>((resolve, reject) => {
      timer = setTimeout(() => reject(new IdentifyError('Discord didn’t answer the bot’s connection in time')), timeoutMs);
      open(u.toString(), {
        message: (data) => {
          const frame = JSON.parse(typeof data === 'string' ? data : decoder.decode(data)) as { op: number; t?: string };
          if (frame.op === Op.Hello) {
            if (socket) socket.send(identify);
            else helloWaiting = true;
          } else if (frame.op === Op.Dispatch && frame.t === 'READY') resolve();
          else if (frame.op === Op.InvalidSession) reject(new IdentifyError('Discord refused the bot’s session'));
        },
        close: (code) => reject(new IdentifyError(`Discord closed the bot’s connection (${code})`, code)),
      }).then((s) => {
        socket = s;
        if (helloWaiting) s.send(identify);
      }, reject);
    });
  } finally {
    clearTimeout(timer);
    (socket as GatewaySocket | null)?.close(1000, 'Connected once');
  }
}
