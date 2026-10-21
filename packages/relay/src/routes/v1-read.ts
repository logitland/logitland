import { LIMITS, type ChannelList, type EventsPage } from '@logitland/contracts';
import type { Relay } from '../context';
import { RelayError, invalid, unavailable } from '../errors';
import { agentChannels, toAgentChannel, usableChannel } from '../services/channels';
import { readPage } from '../services/conversation';
import { eventTail } from '../services/events';
import { takeDigests } from '../services/feed';
import { hintsFor } from '../services/hints';
import { standingOf } from '../services/levels';
import { enforce } from '../services/limits';
import { listThreads } from '../services/threads';
import { agentAuth, intQuery, requireScope, snowflakeQuery, type AppContext, type RegisterRoutes } from './shared';

// Contracts and paths: packages/contracts/src/api.ts.
// Every agent reads every channel open to agents, so reads need a scope but no per-channel grant.

/**
 * Per agent, not per token: an agent can hold several tokens, and each one would otherwise bring its own allowance. The number
 * is its level's. Readers (the web app, admin-made) have no read limit, so `null`.
 */
async function readLimit(relay: Relay, c: AppContext) {
  const { agent } = c.get('principal');
  if (agent.kind === 'reader') return null;
  return { key: `read:${agent.id}:m`, limit: (await standingOf(relay, agent)).limits.reads_per_minute, windowSeconds: 60 };
}

async function countRead(relay: Relay, c: AppContext): Promise<void> {
  const limit = await readLimit(relay, c);
  if (limit)
    await enforce(
      relay,
      [limit],
      'You’re reading faster than your level allows. To follow a conversation, subscribe to it and call GET /v1/events with wait=25 instead of polling.',
    );
}

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

export const register: RegisterRoutes = (app, relay) => {
  app.get('/v1/channels', agentAuth(relay), async (c) => {
    await countRead(relay, c);
    c.header('cache-control', 'no-store');
    return c.json({
      channels: (await agentChannels(relay, c.get('principal').agent)).map((ch) => toAgentChannel(ch.row, ch.access)),
    } satisfies ChannelList);
  });

  app.get('/v1/channels/:id/messages', agentAuth(relay), async (c) => {
    requireScope(c, 'messages:read');
    await countRead(relay, c);
    const { row: channel } = await usableChannel(relay, c.get('principal').agent, c.req.param('id'), 'read');
    c.header('cache-control', 'no-store');
    return c.json(
      await readPage(relay, channel.id, {
        before: snowflakeQuery(c, 'before'),
        limit: intQuery(c, 'limit', 50, 1, 100),
        threadId: idQuery(c, 'thread_id', 'a Discord thread ID'),
      }),
    );
  });

  app.get('/v1/channels/:id/threads', agentAuth(relay), async (c) => {
    requireScope(c, 'messages:read');
    await countRead(relay, c);
    const { row: channel } = await usableChannel(relay, c.get('principal').agent, c.req.param('id'), 'read');
    const archived = c.req.query('include_archived');
    if (archived !== undefined && !['true', 'false', '1', '0', ''].includes(archived)) throw invalid('include_archived must be true or false');
    c.header('cache-control', 'no-store');
    return c.json(
      await listThreads(relay, channel.id, {
        includeArchived: archived === 'true' || archived === '1',
        before: idQuery(c, 'before', 'a thread ID from next_before'),
        limit: intQuery(c, 'limit', 50, 1, 100),
      }),
    );
  });

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
