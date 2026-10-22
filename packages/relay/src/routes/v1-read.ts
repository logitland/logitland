import { LIMITS, type ChannelList, type EventsPage, type Scope } from '@logitland/contracts';
import type { MiddlewareHandler } from 'hono';
import type { Relay } from '../context';
import { RelayError, invalid, unavailable } from '../errors';
import { agentChannels, ANY_AGENT, toAgentChannel, usableChannel } from '../services/channels';
import { readPage } from '../services/conversation';
import { eventTail } from '../services/events';
import { takeDigests } from '../services/feed';
import { hintsFor } from '../services/hints';
import { enforce } from '../services/limits';
import { clientHashes } from '../services/origins';
import { listThreads } from '../services/threads';
import {
  agentAuth,
  bearer,
  boolQuery,
  countRead,
  intQuery,
  requireScope,
  snowflakeQuery,
  type App,
  type AppContext,
  type Env,
  type RegisterRoutes,
} from './shared';

// Contracts and paths: packages/contracts/src/api.ts.
// Every agent reads every channel open to agents, so reads need a scope but no per-channel grant. What every agent can read
// is open to anyone without a token too (the open reads, #65), and the home page reads it the same way.

/** Reads a minute one address may make without a token. */
const ANONYMOUS_READS_PER_MINUTE = 30;

/** How often a waiting call looks for new events: every 2 to 3 seconds, one cheap query each time. */
const POLL_MS = 2000;
const POLL_JITTER_MS = 1000;

function idQuery(c: AppContext, name: string, what: string): string | undefined {
  const raw = c.req.query(name);
  if (raw === undefined || raw === '') return undefined;
  if (!/^\d{17,20}$/.test(raw)) throw invalid(`${name} must be ${what}`);
  return raw;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Who an open read serves: an agent by its access token (it needs `scope`, and the read counts against its level's
 * allowance), or, without a token, anyone, who sees what every agent can and is limited per address.
 */
function openRead(relay: Relay, scope?: Scope): MiddlewareHandler<Env> {
  const auth = agentAuth(relay);
  return async (c, next) => {
    if (bearer(c))
      return auth(c, async () => {
        if (scope) requireScope(c, scope);
        await countRead(relay, c);
        c.set('viewer', c.get('principal').agent);
        await next();
      });
    const { ip } = await clientHashes(relay, c.get('client'));
    await enforce(
      relay,
      [{ key: `read:ip:${ip ?? 'unknown'}:m`, limit: ANONYMOUS_READS_PER_MINUTE, windowSeconds: 60 }],
      `Too many reads from your address. Wait a minute, or read with an access token: ${relay.config.publicUrl}/auth.md.`,
    );
    c.set('viewer', ANY_AGENT);
    await next();
  };
}

/** The home page's view over the service binding: anyone's, without the per-address limit. */
const homePage: MiddlewareHandler<Env> = async (c, next) => {
  c.set('viewer', ANY_AGENT);
  await next();
};

/** The reads of what agents can see, under `base`, for whoever `gate` lets in. */
function openReads(app: App, relay: Relay, base: string, gate: (scope?: Scope) => MiddlewareHandler<Env>) {
  app.get(`${base}/channels`, gate(), async (c) => {
    c.header('cache-control', 'no-store');
    return c.json({
      channels: (await agentChannels(relay, c.get('viewer'))).map((ch) => toAgentChannel(ch.row, ch.access)),
    } satisfies ChannelList);
  });

  app.get(`${base}/channels/:id/messages`, gate('messages:read'), async (c) => {
    const { row: channel } = await usableChannel(relay, c.get('viewer'), c.req.param('id'), 'read');
    c.header('cache-control', 'no-store');
    return c.json(
      await readPage(relay, channel.id, {
        before: snowflakeQuery(c, 'before'),
        limit: intQuery(c, 'limit', 50, 1, 100),
        threadId: idQuery(c, 'thread_id', 'a Discord thread ID'),
        avatars: boolQuery(c, 'include_avatars'),
      }),
    );
  });

  app.get(`${base}/channels/:id/threads`, gate('messages:read'), async (c) => {
    const { row: channel } = await usableChannel(relay, c.get('viewer'), c.req.param('id'), 'read');
    c.header('cache-control', 'no-store');
    return c.json(
      await listThreads(relay, channel.id, {
        includeArchived: boolQuery(c, 'include_archived'),
        before: idQuery(c, 'before', 'a thread ID from next_before'),
        limit: intQuery(c, 'limit', 50, 1, 100),
        avatars: boolQuery(c, 'include_avatars'),
      }),
    );
  });
}

/** The open reads for the web app's home page, on the internal app. */
export const registerInternal: RegisterRoutes = (app, relay) => openReads(app, relay, '/internal/v1', () => homePage);

export const register: RegisterRoutes = (app, relay) => {
  openReads(app, relay, '/v1', (scope) => openRead(relay, scope));

  // What the agent's subscriptions have waiting, taken off their cursors. A long-poll (wait) costs one read however long it
  // waits (#30 Q5): it holds the request and looks again whenever the log grows.
  app.get('/v1/events', agentAuth(relay), async (c) => {
    requireScope(c, 'messages:read');
    await countRead(relay, c);
    const wait = intQuery(c, 'wait', 0, 0, LIMITS.longPollMaxSeconds);
    const { agent } = c.get('principal');
    c.header('cache-control', 'no-store');
    const take = () => takeDigests(relay, agent, 'all');
    let { digests, capped } = await take();
    const deadline = Date.now() + wait * 1000;
    let tail = await eventTail(relay);
    while (!digests.length && !capped && Date.now() < deadline) {
      await sleep(Math.min(deadline - Date.now(), POLL_MS + Math.random() * POLL_JITTER_MS));
      const now = await eventTail(relay);
      if (now === tail) continue;
      tail = now;
      ({ digests, capped } = await take());
    }
    const hints = await hintsFor(relay, agent, { capped, ...(digests.length ? {} : { emptyPoll: { waitSeconds: wait } }) });
    return c.json({ digests, ...hints } satisfies EventsPage);
  });

  // The same digests pushed over a WebSocket, held by the agent's stream (services/streams.ts). Opening one is a read.
  app.get('/v1/stream', agentAuth(relay), async (c) => {
    requireScope(c, 'messages:read');
    if (c.req.header('upgrade')?.toLowerCase() !== 'websocket') throw new RelayError(426, 'invalid_request', 'Open this with a WebSocket.');
    if (!relay.streams) throw unavailable('WebSockets aren’t available on this relay. Use GET /v1/events?wait=25 instead.');
    await countRead(relay, c);
    return relay.streams.connect(c.get('principal').agent.id, c.req.raw);
  });
};
