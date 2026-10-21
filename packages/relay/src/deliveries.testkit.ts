// Shared setup for the subscription and delivery tests (not a test file itself): a relay with channels, an agent with a
// token, Discord messages arriving through intake, and a webhook receiver that records what it gets.

import type { CreateSubscriptionRequest, Digest, EventsPage, Subscription } from '@logitland/contracts';
import { expect } from 'vitest';
import { ingest } from './services/intake';
import { BENCH, LOUNGE, harness, seedAgent, seedChannel, type Harness, type HarnessOptions } from './testing';

export type Receiver = (req: Request) => Response | Promise<Response>;

export const HOOK_HOST = 'hooks.orrery.dev';
export const HOOK = `https://${HOOK_HOST}/logitland`;
export const BOT = '200000000000000050';

/** Answers the delivery challenge the way a well-behaved receiver does. */
export const echoChallenge: Receiver = async (req) => Response.json({ challenge: ((await req.json()) as { challenge: string }).challenge });

/** `received` holds every digest the webhook got, and `signatures` their webhook-signature headers. */
export type Setup = Harness & { agent: Awaited<ReturnType<typeof seedAgent>>; auth: Record<string, string>; received: Digest[]; signatures: string[] };

/** Sets how many subscriptions an agent may hold, orphan and adopted alike: at `level` only, or at every level. */
export const allowSubscriptions = (h: Pick<Harness, 'db'>, n: number, level?: number) =>
  h.db
    .prepare(
      "UPDATE levels SET rules = json_set(rules, '$.limits.orphan.subscriptions', ?1, '$.limits.adopted.subscriptions', ?1) WHERE ?2 IS NULL OR level = ?2",
    )
    .bind(n, level ?? null)
    .run();

/**
 * A relay with the lounge (post) and the bench (read only) open to agents, one agent, and a webhook receiver at HOOK that
 * echoes challenges and keeps every digest it is sent in `received`. `subscriptions` raises every level's cap.
 */
export async function setup(opts: { level?: number; subscriptions?: number; harness?: HarnessOptions } = {}): Promise<Setup> {
  const h = harness(opts.harness);
  if (opts.subscriptions !== undefined) await allowSubscriptions(h, opts.subscriptions);
  await seedChannel(h.relay, { id: LOUNGE, name: 'lounge', access: 'post' });
  await seedChannel(h.relay, { id: BENCH, name: 'lab-bench', access: 'read_only' });
  const agent = await seedAgent(h.relay, { name: 'Orrery', level: opts.level });
  const received: Digest[] = [];
  const signatures: string[] = [];
  h.receivers[HOOK_HOST] = async (req) => {
    const body = (await req.clone().json()) as { type: string };
    if (body.type === 'delivery.challenge') return echoChallenge(req);
    received.push(body as Digest);
    signatures.push(req.headers.get('webhook-signature') ?? '');
    return new Response(null, { status: 204 });
  };
  return { ...h, agent, auth: h.as(agent.token), received, signatures };
}

let counter = 0;

/** A bot's message in a channel, through intake as the Gateway would deliver it. Returns its Discord ID. */
export async function say(s: Pick<Harness, 'relay' | 'now'>, content = 'hello', o: { channel?: string; replyTo?: string } = {}): Promise<string> {
  const id = String(310000000000000000n + BigInt(++counter));
  await ingest(s.relay, {
    source: 'test',
    events: [
      {
        kind: 'message_create',
        channel_id: o.channel ?? LOUNGE,
        message_id: id,
        author: { id: BOT, username: 'newsbot', bot: true },
        content,
        timestamp: s.now().toISOString(),
        ...(o.replyTo ? { reply_to: o.replyTo } : {}),
      },
    ],
  });
  return id;
}

export async function subscribe(s: Setup, body: Partial<CreateSubscriptionRequest> = {}, auth = s.auth): Promise<Subscription> {
  const res = await s.call('POST', '/v1/subscriptions', body.kind === 'replies' ? body : { kind: 'channel', channel_id: LOUNGE, ...body }, auth);
  expect([200, 201]).toContain(res.status);
  return (await res.json()) as Subscription;
}

/** GET /v1/events without waiting. */
export async function poll(s: Setup, auth = s.auth): Promise<EventsPage> {
  const res = await s.call('GET', '/v1/events', undefined, auth);
  expect(res.status).toBe(200);
  return (await res.json()) as EventsPage;
}

/** Points the agent's delivery at HOOK. Returns the signing secret. */
export async function useWebhook(s: Setup, auth = s.auth): Promise<string> {
  const res = await s.call('PUT', '/v1/delivery', { url: HOOK }, auth);
  expect(res.status).toBe(200);
  return ((await res.json()) as { secret: string }).secret;
}

export const contents = (d: Digest) => d.events.map((e) => (e.type === 'message.created' ? e.data.content : e.type));
