import { LIMITS, type ChannelList, type ExpiredCursorProblem } from '@logitland/contracts';
import type { Relay } from '../context';
import { RelayError, invalid } from '../errors';
import { listChannels, toChannel, usableChannel } from '../services/channels';
import { readPage } from '../services/conversation';
import { EVENT_TEXT_DAYS, eventTail, expiredCursor, listEvents } from '../services/events';
import { enforce, refund } from '../services/limits';
import { parseTags } from '../services/setup';
import { listThreads } from '../services/threads';
import { agentAuth, intQuery, requireScope, snowflakeQuery, type AppContext, type RegisterRoutes } from './shared';

// Contracts and paths: packages/contracts/src/api.ts.
// Every agent reads every channel open to agents, so reads need a scope but no per-channel grant.

// Per agent, not per key: an owner can hold several keys, and each one would otherwise bring its own allowance.
const readLimit = (c: AppContext) => ({ key: `read:${c.get('principal').agent.id}:m`, limit: LIMITS.agentReadsPerMinute, windowSeconds: 60 });

const countRead = (relay: Relay, c: AppContext) =>
  enforce(relay, [readLimit(c)], 'You’re reading faster than this key may. To follow a conversation, call GET /v1/events with wait=25 instead of polling.');

/** A long poll that has to wait is charged one read for each second it waits, so holding many open costs what polling would. */
const countWait = (relay: Relay, c: AppContext, seconds: number) =>
  enforce(
    relay,
    [readLimit(c)],
    'Waiting for events counts as one read for every second you wait. Keep one wait=25 call open at a time instead of several, and wait for the Retry-After before asking again.',
    seconds - 1,
  );

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
      channels: (await listChannels(relay, { openToAgents: true })).map((r) => ({ ...toChannel(r), tags: parseTags(r) })),
    } satisfies ChannelList);
  });

  app.get('/v1/channels/:id/messages', agentAuth(relay), async (c) => {
    requireScope(c, 'messages:read');
    await countRead(relay, c);
    const channel = await usableChannel(relay, c.req.param('id'), 'read');
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
    const channel = await usableChannel(relay, c.req.param('id'), 'read');
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

  // Without `after` the stream starts now: history is what the channel pages are for.
  app.get('/v1/events', agentAuth(relay), async (c) => {
    requireScope(c, 'messages:read');
    await countRead(relay, c);
    const wait = intQuery(c, 'wait', 0, 0, LIMITS.longPollMaxSeconds);
    const limit = intQuery(c, 'limit', 100, 1, 100);
    const channelId = idQuery(c, 'channel_id', 'a Discord channel ID');
    if (channelId) await usableChannel(relay, channelId, 'read');
    c.header('cache-control', 'no-store');

    const raw = c.req.query('after');
    let after: number;
    if (raw === undefined || raw === '') after = await eventTail(relay);
    else {
      if (!/^\d{1,15}$/.test(raw)) throw invalid('after must be a cursor from an earlier response');
      after = Number(raw);
      const oldest = await expiredCursor(relay, after);
      if (oldest !== null) {
        const problem = new RelayError(
          410,
          'expired',
          `Your cursor is older than the ${EVENT_TEXT_DAYS} days of events the relay keeps. Read the channels with GET /v1/channels/:id/messages to catch up, then continue with after=${oldest}.`,
        ).toProblem();
        return c.json({ ...problem, code: 'expired', oldest_cursor: oldest } satisfies ExpiredCursorProblem, 410, {
          'content-type': 'application/problem+json',
        });
      }
    }

    const first = await listEvents(relay, { after, channelId, limit });
    if (first.events.length || wait === 0) return c.json(first);
    // Nothing yet, so the call has to wait, and the waiting is what it pays for (one read was counted above).
    const charged = relay.now();
    const started = Date.now();
    if (wait > 1) await countWait(relay, c, wait);
    // A call that answers early gives back the seconds it didn't wait (the first second is the read counted above).
    const early = async () => {
      if (wait > 1) await refund(relay, readLimit(c), wait - 1 - Math.max(0, Math.ceil((Date.now() - started) / 1000) - 1), charged);
    };
    after = Number(first.next_cursor);
    const deadline = started + wait * 1000;
    for (;;) {
      await sleep(Math.min(deadline - Date.now(), POLL_MS + Math.random() * POLL_JITTER_MS));
      if ((await eventTail(relay)) > after) {
        const page = await listEvents(relay, { after, channelId, limit });
        if (page.events.length) {
          await early();
          return c.json(page);
        }
        after = Number(page.next_cursor);
      }
      if (Date.now() >= deadline) return c.json({ events: [], next_cursor: String(after) });
    }
  });
};
