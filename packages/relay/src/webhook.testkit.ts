// Shared by the webhook delivery tests (not a test file itself): an agent with a webhook and a live subscription, a Queue
// that only records what it is given (so deliveries wait in the ledger until a test attempts them), and readers for the
// rows a test checks.

import type { DeliveryMessage, DeliveryQueue } from './context';
import { HOOK_HOST, echoChallenge, say, setup, subscribe, useWebhook, type Setup } from './deliveries.testkit';
import { pushDue } from './services/deliveries';

export type Reply = (req: Request) => Response | Promise<Response>;

export const ok: Reply = () => new Response(null, { status: 200 });
export const reply =
  (status: number, headers: Record<string, string> = {}): Reply =>
  () =>
    new Response(null, { status, headers });

/** A Queue that records what it is sent: `deliveries` the delivery IDs, `pushes` the agents, `batches` each sendBatch's size. */
export function mockQueue(withBatch = true) {
  const deliveries: string[] = [];
  const pushes: { agent: string; delaySeconds?: number }[] = [];
  const batches: number[] = [];
  const take = (body: DeliveryMessage, delaySeconds?: number) =>
    'push' in body ? pushes.push({ agent: body.push, ...(delaySeconds === undefined ? {} : { delaySeconds }) }) : deliveries.push(body.delivery_id);
  const queue: DeliveryQueue = {
    send: async (body, options) => void take(body, options?.delaySeconds),
    ...(withBatch
      ? {
          sendBatch: async (messages: { body: DeliveryMessage; delaySeconds?: number }[]) => {
            batches.push(messages.length);
            for (const m of messages) take(m.body, m.delaySeconds);
          },
        }
      : {}),
  };
  return { queue, deliveries, pushes, batches };
}

/** Points the webhook's host at `answer`, recording every POST but the challenge, which it echoes. */
export function receive(s: Setup, answer: Reply = ok) {
  const requests: { headers: Headers; body: string; redirect: string }[] = [];
  s.receivers[HOOK_HOST] = async (req) => {
    const body = await req.clone().text();
    if ((JSON.parse(body) as { type?: string }).type === 'delivery.challenge') return echoChallenge(req);
    requests.push({ headers: req.headers, body, redirect: req.redirect });
    return answer(req);
  };
  return { requests };
}

/** One more delivery for the agent: something said in the lounge, taken off its live subscription into the ledger. */
export async function next(s: Setup, text = 'hello'): Promise<string> {
  await say(s, text);
  if ((await pushDue(s.relay, s.agent.id)) !== 1) throw new Error('expected one new delivery');
  return (await s.db.prepare('SELECT id FROM deliveries ORDER BY rowid DESC LIMIT 1').first<{ id: string }>())!.id;
}

/**
 * An agent with a webhook answered by `answer`, a live lounge subscription and one pending delivery, with a recording Queue
 * bound so nothing is attempted until the test does it.
 */
export async function hooked(answer: Reply = ok, opts: { withBatch?: boolean } = {}) {
  const s = await setup();
  const q = mockQueue(opts.withBatch);
  s.relay.queue = q.queue;
  const rec = receive(s, answer);
  const secret = await useWebhook(s);
  const sub = await subscribe(s, { frequency: 'live' });
  const id = await next(s);
  return { s, q, rec, secret, sub, id };
}

export const one = <T = Record<string, unknown>>(s: Setup, sql: string, ...args: unknown[]) =>
  s.db
    .prepare(sql)
    .bind(...args)
    .first<T>()
    .then((r) => r!);

export const all = async <T = Record<string, unknown>>(s: Setup, sql: string, ...args: unknown[]) =>
  (
    await s.db
      .prepare(sql)
      .bind(...args)
      .all<T>()
  ).results;

export const delivery = (s: Setup, id: string) =>
  one<{
    status: string;
    attempts: number;
    attempt_limit: number | null;
    next_attempt_at: string | null;
    enqueued_at: string | null;
    last_status_code: number | null;
    last_error: string | null;
    delivered_at: string | null;
  }>(s, 'SELECT status, attempts, attempt_limit, next_attempt_at, enqueued_at, last_status_code, last_error, delivered_at FROM deliveries WHERE id = ?', id);

export const webhook = (s: Setup) =>
  one<{ status: string; failure_streak: number; failing_since: string | null; paused_reason: string | null; paused_at: string | null }>(
    s,
    'SELECT status, failure_streak, failing_since, paused_reason, paused_at FROM agent_webhooks WHERE agent_id = ?',
    s.agent.id,
  );

export const attempts = (s: Setup, id: string) =>
  all<{ n: number; status_code: number | null; error: string | null }>(
    s,
    'SELECT n, status_code, error FROM delivery_attempts WHERE delivery_id = ? ORDER BY n',
    id,
  );

/** Wraps the relay's database so the statement claiming `id` for an attempt throws. */
export function failClaimOf(s: Setup, id: string) {
  const real = s.relay.db;
  s.relay.db = {
    batch: (statements) => real.batch(statements),
    prepare: (sql) => {
      const stmt = real.prepare(sql);
      if (!sql.includes('RETURNING agent_id, body')) return stmt;
      return {
        first: () => stmt.first(),
        all: () => stmt.all(),
        run: () => stmt.run(),
        bind: (...values: unknown[]) => {
          if (values.includes(id)) throw new Error('db unavailable');
          return real.prepare(sql).bind(...values);
        },
      };
    },
  };
}
