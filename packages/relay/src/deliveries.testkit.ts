// Shared setup for deliveries*.test.ts and subscriptions*.test.ts (not a test file itself).

import { newId, type AgentTier, type CreateSubscriptionRequest } from '@logitland/contracts';
import { expect } from 'vitest';
import { fanOut, type EventRow } from './services/deliveries';
import { BENCH, GUILD, LOUNGE, harness, seedAgent, seedChannel, type Harness } from './testing';

export type Receiver = (req: Request) => Response | Promise<Response>;

export const HOOK_HOST = 'hooks.orrery.dev';
export const HOOK = `https://${HOOK_HOST}/logitland`;

/** Answers the subscription challenge the way a well-behaved receiver does. */
export const echoChallenge: Receiver = async (req) => Response.json({ challenge: ((await req.json()) as { challenge: string }).challenge });

export type Setup = Harness & { agent: { id: string; key: string; keyId: string; name: string }; auth: Record<string, string> };

/** A relay with the lounge (post) and the bench (read only) open to agents, one agent, and a receiver that echoes challenges. */
export async function setup(opts: { tier?: AgentTier } = {}): Promise<Setup> {
  const h = harness();
  await seedChannel(h.relay, { id: LOUNGE, name: 'lounge', access: 'post' });
  await seedChannel(h.relay, { id: BENCH, name: 'lab-bench', access: 'read_only' });
  const agent = await seedAgent(h.relay, { name: 'Orrery', tier: opts.tier ?? 'claimed' });
  h.receivers[HOOK_HOST] = echoChallenge;
  return { ...h, agent, auth: h.as(agent.key) };
}

export interface Created {
  id: string;
  agent_id: string;
  url_host: string;
  events: string[];
  channel_ids: string[];
  status: string;
  secret: string;
  failure_streak: number;
}

export const subscribeRaw = (s: Setup, body: Partial<CreateSubscriptionRequest> = {}, auth = s.auth) =>
  s.call('POST', '/v1/subscriptions', { url: HOOK, events: ['message.created'], channel_ids: [LOUNGE], ...body }, auth);

export async function subscribe(s: Setup, body: Partial<CreateSubscriptionRequest> = {}, auth = s.auth): Promise<Created> {
  const res = await subscribeRaw(s, body, auth);
  expect(res.status).toBe(201);
  return (await res.json()) as Created;
}

let counter = 0;

/** Inserts an event row directly, with a payload that has no cursor (as intake stores it). */
export async function insertEvent(s: Pick<Harness, 'relay'>, o: { channel?: string; type?: string; data?: unknown } = {}): Promise<EventRow & { seq: number }> {
  const id = newId('event');
  const type = o.type ?? 'message.created';
  const channel = o.channel ?? LOUNGE;
  const n = ++counter;
  const messageId = `31000000000000${String(n).padStart(4, '0')}`;
  const at = s.relay.now().toISOString();
  const data = o.data ?? {
    message_id: messageId,
    thread_id: null,
    author: { kind: 'human', agent_id: null, author_id: 'p_test', display_name: 'tessellate' },
    content: `hello ${n}`,
    created_at: at,
  };
  const payload = JSON.stringify({ id, type, schema_version: 1, observed_at: at, guild_id: GUILD, channel_id: channel, data });
  await s.relay.db
    .prepare('INSERT INTO events (id, source_key, type, guild_id, channel_id, message_id, payload, observed_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .bind(id, `test:${id}`, type, GUILD, channel, type === 'message.created' ? messageId : null, payload, at)
    .run();
  const row = (await s.relay.db.prepare('SELECT seq FROM events WHERE id = ?').bind(id).first<{ seq: number }>())!;
  return { id, type, guild_id: GUILD, channel_id: channel, payload, seq: row.seq };
}

/** A new event, fanned out. Returns the event and the delivery IDs created. */
export async function publish(s: Pick<Harness, 'relay'>, o: Parameters<typeof insertEvent>[1] = {}) {
  const event = await insertEvent(s, o);
  return { event, ids: await fanOut(s.relay, event) };
}

export const one = async <T>(s: Pick<Harness, 'db'>, sql: string, ...args: unknown[]) =>
  (await s.db
    .prepare(sql)
    .bind(...args)
    .first<T>())!;
export const all = async <T>(s: Pick<Harness, 'db'>, sql: string, ...args: unknown[]) =>
  (
    await s.db
      .prepare(sql)
      .bind(...args)
      .all<T>()
  ).results;

/** A receiver that records what it gets and answers with `reply`. */
export function recorder(reply: Receiver = () => new Response(null, { status: 200 })) {
  const requests: { headers: Headers; body: string; redirect: string; url: string }[] = [];
  const handler: Receiver = async (req) => {
    requests.push({ headers: req.headers, body: await req.clone().text(), redirect: req.redirect, url: req.url });
    return reply(req);
  };
  return { requests, handler };
}
