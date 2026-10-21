import { newId } from '@logitland/contracts';
import { verify } from '@logitland/webhooks';
import { describe, expect, it } from 'vitest';
import { all, HOOK_HOST, one, publish, recorder, setup, subscribe, type Setup } from './deliveries.testkit';
import { attemptDelivery, backoffSeconds, drainDue, fanOut, handleDeliveryBatch, replayDelivery } from './services/deliveries';
import { dohResolver } from './services/destinations';
import { BENCH, LOUNGE, seedAgent } from './testing';

const ok = () => new Response(null, { status: 200 });
const reply =
  (status: number, headers: Record<string, string> = {}) =>
  () =>
    new Response(null, { status, headers });

const delivery = (s: Setup, id: string) =>
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
const subscription = (s: Setup, id: string) =>
  one<{ status: string; failure_streak: number; paused_reason: string | null; paused_at: string | null }>(
    s,
    'SELECT status, failure_streak, paused_reason, paused_at FROM subscriptions WHERE id = ?',
    id,
  );
const attempts = (s: Setup, id: string) =>
  all<{ n: number; status_code: number | null; error: string | null }>(
    s,
    'SELECT n, status_code, error FROM delivery_attempts WHERE delivery_id = ? ORDER BY n',
    id,
  );

/** A subscribed agent, a recording receiver and one pending delivery. */
async function ready(reply_: () => Response | Promise<Response> = ok) {
  const s = await setup();
  const sub = await subscribe(s);
  const rec = recorder(reply_);
  s.receivers[HOOK_HOST] = rec.handler;
  const { event, ids } = await publish(s);
  return { s, sub, rec, event, id: ids[0]! };
}

function mockQueue(withBatch = true) {
  const sent: string[] = [];
  const batches: number[] = [];
  const queue = {
    send: async (body: { delivery_id: string }) => void sent.push(body.delivery_id),
    ...(withBatch
      ? {
          sendBatch: async (messages: { body: { delivery_id: string } }[]) => {
            batches.push(messages.length);
            sent.push(...messages.map((m) => m.body.delivery_id));
          },
        }
      : {}),
  };
  return { queue, sent, batches };
}

/** Subscriptions inserted directly (the cap would stop us creating this many), for fan-out volume. */
async function seedSubscriptions(s: Setup, agentId: string, n: number, channel = LOUNGE) {
  const at = s.relay.now().toISOString();
  const ids = Array.from({ length: n }, () => newId('subscription'));
  await s.relay.db.batch(
    ids.flatMap((id) => [
      s.relay.db
        .prepare(
          "INSERT INTO subscriptions (id, agent_id, url_ciphertext, url_host, events, channel_ids, secret_ciphertext, status, created_at) VALUES (?, ?, 'x', ?, '[\"message.created\"]', ?, 'x', 'active', ?)",
        )
        .bind(id, agentId, HOOK_HOST, JSON.stringify([channel]), at),
      s.relay.db.prepare('INSERT INTO subscription_channels (subscription_id, channel_id) VALUES (?, ?)').bind(id, channel),
    ]),
  );
  return ids;
}

describe('fan-out', () => {
  it('matches subscriptions through their channels and event types', async () => {
    const s = await setup();
    const a1 = await subscribe(s, { channel_ids: [LOUNGE], events: ['message.created'] });
    const a2 = await subscribe(s, { channel_ids: [BENCH], events: ['message.created'] });
    const a3 = await subscribe(s, { channel_ids: [LOUNGE], events: ['message.deleted'] });
    const other = await seedAgent(s.relay, { name: 'Other' });
    const b1 = await subscribe(s, { channel_ids: [LOUNGE, BENCH], events: ['message.created', 'message.updated'] }, s.as(other.token));

    const subsOf = async (ids: string[]) =>
      (await all<{ subscription_id: string }>(s, 'SELECT subscription_id FROM deliveries WHERE id IN (SELECT value FROM json_each(?))', JSON.stringify(ids)))
        .map((r) => r.subscription_id)
        .sort();
    expect(await subsOf((await publish(s, { channel: LOUNGE, type: 'message.created' })).ids)).toEqual([a1.id, b1.id].sort());
    // A removal goes to everyone who gets message text, whether or not they asked for it, and to the one that asked for it alone.
    expect(
      await subsOf((await publish(s, { channel: LOUNGE, type: 'message.deleted', data: { message_id: '310000000000009999', removed_by: 'author' } })).ids),
    ).toEqual([a1.id, a3.id, b1.id].sort());
    expect(await subsOf((await publish(s, { channel: BENCH, type: 'message.created' })).ids)).toEqual([a2.id, b1.id].sort());
    expect(
      (await publish(s, { channel: LOUNGE, type: 'message.updated', data: { message_id: '310000000000009999', edited_at: '2026-10-19T03:00:00.000Z' } })).ids,
    ).toHaveLength(1);

    const row = await one<{ status: string; attempts: number; next_attempt_at: string; enqueued_at: string | null; event_type: string }>(
      s,
      'SELECT * FROM deliveries LIMIT 1',
    );
    expect(row).toMatchObject({ status: 'pending', attempts: 0, next_attempt_at: s.relay.now().toISOString(), enqueued_at: null });
  });

  it('skips subscriptions that aren’t active, and agents that aren’t active', async () => {
    const s = await setup();
    const paused = await subscribe(s);
    const disabled = await subscribe(s);
    const live = await subscribe(s);
    await s.db.prepare("UPDATE subscriptions SET status = 'paused' WHERE id = ?").bind(paused.id).run();
    await s.db.prepare("UPDATE subscriptions SET status = 'disabled' WHERE id = ?").bind(disabled.id).run();
    const off = await seedAgent(s.relay, { name: 'Sleeper' });
    const [offSub] = await seedSubscriptions(s, off.id, 1);
    await s.db.prepare("UPDATE agents SET status = 'suspended' WHERE id = ?").bind(off.id).run();
    const { ids } = await publish(s);
    const rows = await all<{ subscription_id: string }>(s, 'SELECT subscription_id FROM deliveries');
    expect(ids).toHaveLength(1);
    expect(rows).toEqual([{ subscription_id: live.id }]);
    expect(rows.some((r) => r.subscription_id === offSub)).toBe(false);
  });

  it('sends gap events to every active subscription of the channel, whatever events it asked for', async () => {
    const s = await setup({ subscriptions: 4 });
    const asksForCreated = await subscribe(s, { channel_ids: [LOUNGE], events: ['message.created'] });
    const asksForDeleted = await subscribe(s, { channel_ids: [LOUNGE, BENCH], events: ['message.deleted'] });
    const otherChannel = await subscribe(s, { channel_ids: [BENCH], events: ['message.created'] });
    const paused = await subscribe(s, { channel_ids: [LOUNGE], events: ['subscription.gap'] });
    await s.db.prepare("UPDATE subscriptions SET status = 'paused' WHERE id = ?").bind(paused.id).run();

    const gap = { window_start: '2026-10-19T02:00:00.000Z', window_end: '2026-10-19T03:00:00.000Z', resume_cursor: '41', reason: 'Gateway session lost' };
    const { ids } = await publish(s, { channel: LOUNGE, type: 'subscription.gap', data: gap });
    const got = (
      await all<{ subscription_id: string; event_type: string }>(
        s,
        'SELECT subscription_id, event_type FROM deliveries WHERE id IN (SELECT value FROM json_each(?))',
        JSON.stringify(ids),
      )
    ).sort((x, y) => x.subscription_id.localeCompare(y.subscription_id));
    expect(got).toEqual([asksForCreated.id, asksForDeleted.id].sort().map((id) => ({ subscription_id: id, event_type: 'subscription.gap' })));
    expect(got.some((g) => g.subscription_id === otherChannel.id)).toBe(false);
  });

  it('creates and enqueues nothing the second time for the same event', async () => {
    const s = await setup();
    const q = mockQueue();
    s.relay.queue = q.queue;
    await subscribe(s);
    const { event, ids } = await publish(s);
    expect(ids).toHaveLength(1);
    expect(q.sent).toEqual(ids);
    expect(await fanOut(s.relay, event)).toEqual([]);
    expect(q.sent).toEqual(ids);
    expect(await one(s, 'SELECT COUNT(*) AS n FROM deliveries')).toEqual({ n: 1 });
  });

  it('inserts in batches and enqueues with sendBatch in chunks of 100, stamping enqueued_at', async () => {
    const s = await setup();
    const q = mockQueue();
    s.relay.queue = q.queue;
    await seedSubscriptions(s, s.agent.id, 230);
    const { ids } = await publish(s);
    expect(ids).toHaveLength(230);
    expect(q.batches).toEqual([100, 100, 30]);
    expect(new Set(q.sent).size).toBe(230);
    expect(await one(s, 'SELECT COUNT(*) AS n FROM deliveries WHERE enqueued_at = ?', s.relay.now().toISOString())).toEqual({ n: 230 });
  });

  it('falls back to send when the queue has no sendBatch', async () => {
    const s = await setup();
    const q = mockQueue(false);
    s.relay.queue = q.queue;
    await seedSubscriptions(s, s.agent.id, 7);
    const { ids } = await publish(s);
    expect(q.batches).toEqual([]);
    expect(q.sent.sort()).toEqual([...ids].sort());
    expect(await one(s, 'SELECT COUNT(*) AS n FROM deliveries WHERE enqueued_at IS NOT NULL')).toEqual({ n: 7 });
  });

  it('keeps the deliveries when the queue fails, leaving enqueued_at empty for the cron scan', async () => {
    const s = await setup();
    const q = mockQueue();
    s.relay.queue = { ...q.queue, sendBatch: async () => Promise.reject(new Error('Too Many Requests')) };
    await subscribe(s);
    const { ids } = await publish(s);
    expect(ids).toHaveLength(1);
    expect((await delivery(s, ids[0]!)).enqueued_at).toBeNull();
    expect(s.log.lines.some((l) => l.event === 'deliveries.enqueue_failed')).toBe(true);

    const healthy = mockQueue();
    s.relay.queue = healthy.queue;
    expect(await drainDue(s.relay)).toBe(1);
    expect(healthy.sent).toEqual(ids);
  });
});

describe('a delivery attempt', () => {
  it('sends the stored payload plus the cursor, signed, with the delivery ID as webhook-id', async () => {
    const { s, sub, rec, event, id } = await ready();
    expect(await attemptDelivery(s.relay, id)).toEqual({ outcome: 'delivered' });
    expect(rec.requests).toHaveLength(1);
    const req = rec.requests[0]!;
    expect(JSON.parse(event.payload)).not.toHaveProperty('cursor');
    expect(JSON.parse(req.body)).toEqual({ ...JSON.parse(event.payload), cursor: String(event.seq) });
    expect(req.headers.get('webhook-id')).toBe(id);
    expect(req.headers.get('content-type')).toBe('application/json');
    expect(req.headers.get('authorization')).toBeNull();
    expect(req.redirect).toBe('manual');
    await expect(verify(req.headers, req.body, sub.secret, { now: s.relay.now() })).resolves.toMatchObject({ id });

    expect(await delivery(s, id)).toMatchObject({
      status: 'delivered',
      attempts: 1,
      last_status_code: 200,
      last_error: null,
      next_attempt_at: null,
      delivered_at: s.relay.now().toISOString(),
    });
    expect(await attempts(s, id)).toEqual([{ n: 1, status_code: 200, error: null }]);
  });

  it('signs with both secrets while the previous one is valid, and only the new one afterwards', async () => {
    const { s, sub, rec, id } = await ready();
    const rotated = (await (await s.call('POST', `/v1/subscriptions/${sub.id}/rotate-secret`, undefined, s.auth)).json()) as { secret: string };

    s.advance(23 * 3600_000 + 59 * 60_000);
    await attemptDelivery(s.relay, id);
    const dual = rec.requests[0]!;
    expect(dual.headers.get('webhook-signature')!.split(' ')).toHaveLength(2);
    await expect(verify(dual.headers, dual.body, rotated.secret, { now: s.relay.now() })).resolves.toBeTruthy();
    await expect(verify(dual.headers, dual.body, sub.secret, { now: s.relay.now() })).resolves.toBeTruthy();

    s.advance(2 * 60_000); // 24 h and 1 min after the rotation
    const { ids } = await publish(s);
    await attemptDelivery(s.relay, ids[0]!);
    const single = rec.requests[1]!;
    expect(single.headers.get('webhook-signature')!.split(' ')).toHaveLength(1);
    await expect(verify(single.headers, single.body, rotated.secret, { now: s.relay.now() })).resolves.toBeTruthy();
    await expect(verify(single.headers, single.body, sub.secret, { now: s.relay.now() })).rejects.toThrow();
  });

  it('retries a 503 with backoff and keeps the same webhook-id', async () => {
    let status = 503;
    const { s, sub, rec, id } = await ready(() => new Response(null, { status }));
    const first = await attemptDelivery(s.relay, id);
    expect(first.outcome).toBe('retry');
    const after = (first as { afterSeconds: number }).afterSeconds;
    expect(after).toBeGreaterThanOrEqual(15);
    expect(after).toBeLessThanOrEqual(30);
    expect(await delivery(s, id)).toMatchObject({
      status: 'retrying',
      attempts: 1,
      last_status_code: 503,
      last_error: '503 from the destination',
      next_attempt_at: new Date(s.relay.now().getTime() + after * 1000).toISOString(),
    });
    expect((await subscription(s, sub.id)).failure_streak).toBe(0);

    expect((await attemptDelivery(s.relay, id)).outcome).toBe('skipped'); // not due yet
    s.advance(after * 1000);
    status = 200;
    expect(await attemptDelivery(s.relay, id)).toEqual({ outcome: 'delivered' });
    expect(rec.requests.map((r) => r.headers.get('webhook-id'))).toEqual([id, id]);
    expect(await attempts(s, id)).toEqual([
      { n: 1, status_code: 503, error: '503 from the destination' },
      { n: 2, status_code: 200, error: null },
    ]);
  });

  it('honours Retry-After as seconds or a date, up to 24 hours', async () => {
    const cases: [string, number][] = [
      ['120', 120],
      ['172800', 86_400],
    ];
    for (const [header, expected] of cases) {
      const { s, id } = await ready(reply(503, { 'retry-after': header }));
      expect(await attemptDelivery(s.relay, id), header).toEqual({ outcome: 'retry', afterSeconds: expected });
      expect((await delivery(s, id)).next_attempt_at).toBe(new Date(s.relay.now().getTime() + expected * 1000).toISOString());
    }
    const dated = await ready(reply(429, { 'retry-after': new Date('2026-10-19T03:05:00Z').toUTCString() }));
    expect(await attemptDelivery(dated.s.relay, dated.id)).toEqual({ outcome: 'retry', afterSeconds: 300 });
    const junk = await ready(reply(503, { 'retry-after': 'soon' }));
    const result = await attemptDelivery(junk.s.relay, junk.id);
    expect(result.outcome === 'retry' && result.afterSeconds >= 15 && result.afterSeconds <= 30).toBe(true);
  });

  it.each([429, 408, 500, 502])('retries a %i', async (status) => {
    const { s, id } = await ready(reply(status));
    expect((await attemptDelivery(s.relay, id)).outcome).toBe('retry');
    expect((await delivery(s, id)).status).toBe('retrying');
  });

  it.each([400, 401, 404, 422])('fails a %i without retrying', async (status) => {
    const { s, sub, id } = await ready(reply(status));
    expect(await attemptDelivery(s.relay, id)).toEqual({ outcome: 'failed', reason: `${status} from the destination` });
    expect(await delivery(s, id)).toMatchObject({ status: 'failed', attempts: 1, last_status_code: status, next_attempt_at: null });
    expect((await subscription(s, sub.id)).failure_streak).toBe(1);
  });

  it('never follows a redirect, and fails the delivery', async () => {
    const elsewhere = recorder();
    const { s, sub, rec, id } = await ready(reply(302, { location: 'http://169.254.169.254/latest' }));
    s.receivers['169.254.169.254'] = elsewhere.handler;
    expect(await attemptDelivery(s.relay, id)).toEqual({ outcome: 'failed', reason: '302 redirect not followed' });
    expect(rec.requests).toHaveLength(1);
    expect(rec.requests[0]!.redirect).toBe('manual');
    expect(elsewhere.requests).toHaveLength(0);
    expect((await subscription(s, sub.id)).failure_streak).toBe(1);
  });

  it('disables the subscription on 410 and drops what was waiting for it', async () => {
    const { s, sub, id } = await ready(reply(410));
    const second = (await publish(s)).ids[0]!;
    expect(await attemptDelivery(s.relay, id)).toMatchObject({ outcome: 'failed' });
    expect(await subscription(s, sub.id)).toMatchObject({ status: 'disabled', failure_streak: 0 });
    expect((await subscription(s, sub.id)).paused_reason).toContain('410');
    expect(await delivery(s, id)).toMatchObject({ status: 'failed', last_status_code: 410 });
    expect(await delivery(s, second)).toMatchObject({ status: 'dropped', next_attempt_at: null });
    expect(await one(s, 'SELECT COUNT(*) AS n FROM subscription_channels WHERE subscription_id = ?', sub.id)).toEqual({ n: 0 });
    expect(await one(s, "SELECT actor_type, actor_id, target_id FROM audit_log WHERE action = 'subscription.disabled'")).toEqual({
      actor_type: 'system',
      actor_id: 'relay',
      target_id: sub.id,
    });
    expect((await publish(s)).ids).toEqual([]);
    const listed = (await (await s.call('GET', '/v1/subscriptions', undefined, s.auth)).json()) as { subscriptions: { id: string; status: string }[] };
    expect(listed.subscriptions).toMatchObject([{ id: sub.id, status: 'disabled' }]);
  });

  it('retries a lost connection and a timeout with a plain reason', async () => {
    const lost = await ready(() => Promise.reject(new TypeError('socket closed')));
    expect(await attemptDelivery(lost.s.relay, lost.id)).toMatchObject({ outcome: 'retry' });
    expect((await delivery(lost.s, lost.id)).last_error).toBe('Couldn’t connect to the destination');
    const slow = await ready(() => Promise.reject(new DOMException('timed out', 'TimeoutError')));
    expect(await attemptDelivery(slow.s.relay, slow.id)).toMatchObject({ outcome: 'retry' });
    expect((await delivery(slow.s, slow.id)).last_error).toBe('No answer within 10 s');
  });

  it('checks the destination again before sending, without naming the address', async () => {
    const { s, rec, id } = await ready();
    s.dns[HOOK_HOST] = ['10.1.2.3']; // rebinding after registration
    expect(await attemptDelivery(s.relay, id)).toMatchObject({ outcome: 'retry' });
    expect(rec.requests).toHaveLength(0);
    const row = await delivery(s, id);
    expect(row.last_error).toBe('Refused at send time: The hostname resolves to a non-public address');
    expect(JSON.stringify(await attempts(s, id))).not.toContain('10.1.2.3');

    s.dns[HOOK_HOST] = ['93.184.216.34'];
    s.relay.resolver = dohResolver((async () => Response.json({ Status: 2 })) as typeof fetch);
    s.advance(60_000);
    expect(await attemptDelivery(s.relay, id)).toMatchObject({ outcome: 'retry' });
    expect((await delivery(s, id)).last_error).toContain('looked up');
    expect(rec.requests).toHaveLength(0);
  });

  it('records an unexpected error as an attempt with a generic message, and retries it', async () => {
    const { s, sub, rec, id } = await ready();
    s.relay.resolver = {
      resolve: async () => {
        throw new Error('boom: 10.0.0.1 hunter2');
      },
    };
    const result = await attemptDelivery(s.relay, id);
    expect(result.outcome).toBe('retry');
    expect(await delivery(s, id)).toMatchObject({ status: 'retrying', attempts: 1, last_status_code: null, last_error: 'Internal error while delivering' });
    expect((await delivery(s, id)).next_attempt_at).not.toBeNull();
    expect(await attempts(s, id)).toEqual([{ n: 1, status_code: null, error: 'Internal error while delivering' }]);
    expect(rec.requests).toHaveLength(0);
    expect(s.log.lines.some((l) => l.event === 'delivery.attempt_crashed')).toBe(true);
    expect((await subscription(s, sub.id)).failure_streak).toBe(0);

    // At the attempt limit it fails instead of retrying, and counts as one failed delivery.
    await s.db.prepare('UPDATE deliveries SET attempts = 23, next_attempt_at = ? WHERE id = ?').bind(s.relay.now().toISOString(), id).run();
    expect(await attemptDelivery(s.relay, id)).toEqual({ outcome: 'failed', reason: 'Internal error while delivering; gave up after 24 attempts' });
    expect((await subscription(s, sub.id)).failure_streak).toBe(1);
  });

  it('is claimed by one worker at a time', async () => {
    const { s, rec, id } = await ready();
    const results = await Promise.all([attemptDelivery(s.relay, id), attemptDelivery(s.relay, id)]);
    expect(results.map((r) => r.outcome).sort()).toEqual(['delivered', 'skipped']);
    expect(rec.requests).toHaveLength(1);
    expect((await delivery(s, id)).attempts).toBe(1);
  });

  describe('drops the delivery when, by the time of the attempt', () => {
    const cases: [string, (s: Setup, subId: string) => Promise<unknown>, string][] = [
      ['the subscription was paused', (s, id) => s.db.prepare("UPDATE subscriptions SET status = 'paused' WHERE id = ?").bind(id).run(), 'subscription'],
      ['the agent was turned off', (s) => s.db.prepare("UPDATE agents SET status = 'off' WHERE id = ?").bind(s.agent.id).run(), 'agent is no longer active'],
      [
        'the agent lost messages:read',
        (s) => s.db.prepare('UPDATE agents SET scopes = ? WHERE id = ?').bind('["messages:write","subscriptions:manage"]', s.agent.id).run(),
        'messages:read',
      ],
      ['the channel was closed to agents', (s) => s.db.prepare("UPDATE channels SET agent_access = 'off' WHERE id = ?").bind(LOUNGE).run(), 'channel'],
    ];
    it.each(cases)('%s', async (_name, change, reason) => {
      const { s, sub, rec, id } = await ready();
      await change(s, sub.id);
      const dropped = await drop(s, id);
      expect(rec.requests).toHaveLength(0);
      expect(dropped.reason).toContain(reason);
      expect(await delivery(s, id)).toMatchObject({ status: 'dropped', attempts: 1, next_attempt_at: null });
      expect((await attempts(s, id))[0]).toMatchObject({ n: 1, status_code: null });
      expect((await subscription(s, sub.id)).failure_streak).toBe(0);
    });
    async function drop(s: Setup, id: string) {
      const result = await attemptDelivery(s.relay, id);
      expect(result.outcome).toBe('dropped');
      return result as { reason: string };
    }
  });
});

describe('the failure streak', () => {
  it('counts failed deliveries, not attempts, and resets on success', async () => {
    let status = 503;
    const { s, sub, id } = await ready(() => new Response(null, { status }));
    for (let i = 0; i < 4; i++) {
      await attemptDelivery(s.relay, id);
      s.advance(7 * 3600_000);
      // Not what is under test here: the pause after a day of failing has its own tests.
      await s.db.prepare('UPDATE subscriptions SET failing_since = NULL WHERE id = ?').bind(sub.id).run();
    }
    expect((await delivery(s, id)).attempts).toBe(4);
    expect((await subscription(s, sub.id)).failure_streak).toBe(0);

    status = 400;
    const bad = [(await publish(s)).ids[0]!, (await publish(s)).ids[0]!];
    for (const [i, d] of bad.entries()) {
      await attemptDelivery(s.relay, d);
      expect((await subscription(s, sub.id)).failure_streak).toBe(i + 1);
    }
    status = 200;
    expect(await attemptDelivery(s.relay, id)).toEqual({ outcome: 'delivered' });
    expect((await subscription(s, sub.id)).failure_streak).toBe(0);
  });

  it('counts a delivery that runs out of attempts once', async () => {
    const { s, sub, id } = await ready(reply(503));
    let last;
    for (let i = 0; i < 24; i++) {
      last = await attemptDelivery(s.relay, id);
      s.advance(7 * 3600_000);
      await s.db.prepare('UPDATE subscriptions SET failing_since = NULL WHERE id = ?').bind(sub.id).run();
    }
    expect(last).toEqual({ outcome: 'failed', reason: '503 from the destination; gave up after 24 attempts' });
    expect(await delivery(s, id)).toMatchObject({ status: 'failed', attempts: 24, next_attempt_at: null });
    expect((await attempts(s, id)).length).toBe(24);
    expect((await subscription(s, sub.id)).failure_streak).toBe(1);
  });

  it('pauses the subscription at 50 failed deliveries and drops the ones still waiting', async () => {
    const { s, sub, rec, id } = await ready(reply(400));
    const ids = [id];
    for (let i = 1; i < 53; i++) ids.push((await publish(s)).ids[0]!);
    for (const d of ids.slice(0, 49)) await attemptDelivery(s.relay, d);
    expect(await subscription(s, sub.id)).toMatchObject({ status: 'active', failure_streak: 49 });

    await attemptDelivery(s.relay, ids[49]!);
    expect(await subscription(s, sub.id)).toMatchObject({ status: 'paused', failure_streak: 50, paused_at: s.relay.now().toISOString() });
    expect((await subscription(s, sub.id)).paused_reason).toContain('50');
    for (const d of ids.slice(50)) expect(await delivery(s, d)).toMatchObject({ status: 'dropped', next_attempt_at: null });
    expect(await one(s, "SELECT actor_type, target_id FROM audit_log WHERE action = 'subscription.paused'")).toEqual({
      actor_type: 'system',
      target_id: sub.id,
    });
    expect(rec.requests).toHaveLength(50);
    expect((await publish(s)).ids).toEqual([]);
    expect(await one(s, 'SELECT status, failure_streak FROM subscriptions WHERE id = ?', sub.id)).toEqual({ status: 'paused', failure_streak: 50 });
    const listed = (await (await s.call('GET', '/v1/subscriptions', undefined, s.auth)).json()) as {
      subscriptions: { status: string; failure_streak: number; paused_reason: string }[];
    };
    expect(listed.subscriptions[0]).toMatchObject({ status: 'paused', failure_streak: 50 });

    // Resuming starts afresh: the streak is zero and events are delivered again.
    expect((await s.call('POST', `/v1/subscriptions/${sub.id}/resume`, undefined, s.auth)).status).toBe(200);
    expect(await subscription(s, sub.id)).toMatchObject({ status: 'active', failure_streak: 0, paused_reason: null });
    expect((await publish(s)).ids).toHaveLength(1);
  });
});

describe('what an agent sees of its deliveries', () => {
  it('lists them newest first with every attempt, in pages', async () => {
    let status = 503;
    const { s, sub, id } = await ready(() => new Response(null, { status }));
    await attemptDelivery(s.relay, id);
    s.advance(60_000);
    status = 200;
    await attemptDelivery(s.relay, id);
    s.advance(1000);
    const second = (await publish(s)).ids[0]!;

    const res = await s.call('GET', `/v1/subscriptions/${sub.id}/deliveries`, undefined, s.auth);
    expect(res.status).toBe(200);
    const page = (await res.json()) as {
      deliveries: { id: string; status: string; attempts: number; attempt_log: { n: number; status_code: number | null }[]; url_host?: string }[];
      next_before: string | null;
    };
    expect(page.deliveries.map((d) => d.id)).toEqual([second, id].sort().reverse());
    const first = page.deliveries.find((d) => d.id === id)!;
    expect(first).toMatchObject({ status: 'delivered', attempts: 2 });
    expect(first.attempt_log.map((a) => [a.n, a.status_code])).toEqual([
      [1, 503],
      [2, 200],
    ]);
    expect(first).not.toHaveProperty('url_host');
    expect(page.deliveries.find((d) => d.id === second)!.attempt_log).toEqual([]);
    expect(page.next_before).toBeNull();

    const one_ = (await (await s.call('GET', `/v1/subscriptions/${sub.id}/deliveries?limit=1`, undefined, s.auth)).json()) as typeof page;
    expect(one_.deliveries).toHaveLength(1);
    expect(one_.next_before).toBe(one_.deliveries[0]!.id);
    const rest = (await (
      await s.call('GET', `/v1/subscriptions/${sub.id}/deliveries?limit=1&before=${one_.next_before}`, undefined, s.auth)
    ).json()) as typeof page;
    expect(rest.deliveries.map((d) => d.id)).toEqual([page.deliveries[1]!.id]);
    const delivered = (await (await s.call('GET', `/v1/subscriptions/${sub.id}/deliveries?status=delivered`, undefined, s.auth)).json()) as typeof page;
    expect(delivered.deliveries.map((d) => d.id)).toEqual([id]);
    expect((await s.call('GET', `/v1/subscriptions/${sub.id}/deliveries?status=nope`, undefined, s.auth)).status).toBe(400);
  });
});

describe('drainDue', () => {
  it('without a queue, attempts due deliveries itself, 100 a run, skipping rows that aren’t due', async () => {
    const { s, rec, id } = await ready();
    for (let i = 0; i < 119; i++) await publish(s);
    const waiting = (await publish(s)).ids[0]!;
    await s.db
      .prepare("UPDATE deliveries SET status = 'retrying', next_attempt_at = ? WHERE id = ?")
      .bind(new Date(s.relay.now().getTime() + 3600_000).toISOString(), waiting)
      .run();

    expect(await drainDue(s.relay)).toBe(100);
    expect(rec.requests).toHaveLength(100);
    expect(await one(s, "SELECT COUNT(*) AS n FROM deliveries WHERE status = 'delivered'")).toEqual({ n: 100 });
    expect(await drainDue(s.relay)).toBe(20);
    expect(await drainDue(s.relay)).toBe(0);
    expect((await delivery(s, waiting)).status).toBe('retrying');
    expect((await delivery(s, id)).status).toBe('delivered');
  });

  it('without a queue, one row that throws doesn’t stop the others', async () => {
    const { s, rec, id } = await ready();
    const other = (await publish(s)).ids[0]!;
    const real = s.relay.db;
    s.relay.db = {
      batch: (statements) => real.batch(statements),
      prepare: (sql) => {
        const stmt = real.prepare(sql);
        if (!sql.includes('RETURNING subscription_id')) return stmt;
        return {
          ...stmtMethods(stmt),
          bind: (...values: unknown[]) =>
            values.includes(id)
              ? (() => {
                  throw new Error('db unavailable');
                })()
              : real.prepare(sql).bind(...values),
        };
      },
    };
    expect(await drainDue(s.relay)).toBe(2);
    expect(rec.requests).toHaveLength(1);
    expect((await delivery(s, other)).status).toBe('delivered');
    expect((await delivery(s, id)).status).toBe('pending');
    expect(s.log.lines.some((l) => l.event === 'deliveries.drain_failed')).toBe(true);
  });

  it('with a queue, re-enqueues only rows never enqueued or enqueued over 10 minutes ago, and not twice', async () => {
    const s = await setup();
    const q = mockQueue();
    await subscribe(s);
    s.relay.queue = q.queue;
    const rec = recorder();
    s.receivers[HOOK_HOST] = rec.handler;
    const fresh = (await publish(s)).ids[0]!; // enqueued by fan-out
    expect(q.sent).toEqual([fresh]);

    expect(await drainDue(s.relay)).toBe(0);
    s.advance(9 * 60_000);
    expect(await drainDue(s.relay)).toBe(0);

    s.advance(2 * 60_000); // 11 minutes since it was enqueued
    expect(await drainDue(s.relay)).toBe(1);
    expect(q.sent).toEqual([fresh, fresh]);
    expect((await delivery(s, fresh)).enqueued_at).toBe(s.relay.now().toISOString());
    expect(await drainDue(s.relay)).toBe(0);
    expect(q.sent).toHaveLength(2);
    expect(rec.requests).toHaveLength(0); // the queue consumer attempts; the cron scan doesn’t

    // Never enqueued (the earlier enqueue failed): picked up at once. Not due yet: left alone.
    const unsent = (await publish(s)).ids[0]!;
    await s.db.prepare('UPDATE deliveries SET enqueued_at = NULL WHERE id = ?').bind(unsent).run();
    const later = (await publish(s)).ids[0]!;
    await s.db
      .prepare("UPDATE deliveries SET enqueued_at = NULL, status = 'retrying', next_attempt_at = ? WHERE id = ?")
      .bind(new Date(s.relay.now().getTime() + 3600_000).toISOString(), later)
      .run();
    expect(await drainDue(s.relay)).toBe(1);
    expect(q.sent.at(-1)).toBe(unsent);
    expect((await delivery(s, later)).enqueued_at).toBeNull();
  });

  it('with a queue, takes the whole backlog in one run and uses sendBatch (100 at a time) or send', async () => {
    for (const withBatch of [true, false]) {
      const s = await setup();
      await subscribe(s);
      for (let i = 0; i < 119; i++) await publish(s);
      await publish(s);
      const q = mockQueue(withBatch);
      s.relay.queue = q.queue;
      expect(await drainDue(s.relay)).toBe(120);
      expect(q.sent).toHaveLength(120);
      expect(q.batches).toEqual(withBatch ? [100, 20] : []);
      expect(await one(s, 'SELECT COUNT(*) AS n FROM deliveries WHERE enqueued_at IS NOT NULL')).toEqual({ n: 120 });
      expect(await drainDue(s.relay)).toBe(0);
    }
  });
});

describe('handleDeliveryBatch', () => {
  const message = (body: unknown) => {
    const calls: { ack: number; retry: ({ delaySeconds?: number } | undefined)[] } = { ack: 0, retry: [] };
    return { body, calls, ack: () => void calls.ack++, retry: (options?: { delaySeconds?: number }) => void calls.retry.push(options) };
  };

  it('handles each message on its own: one that throws is retried after 60 s and the rest carry on', async () => {
    const { s, rec, id: good1 } = await ready();
    const good2 = (await publish(s)).ids[0]!;
    const broken = (await publish(s)).ids[0]!;
    const real = s.relay.db;
    s.relay.db = {
      batch: (statements) => real.batch(statements),
      prepare: (sql) => {
        const stmt = real.prepare(sql);
        if (!sql.includes('RETURNING subscription_id')) return stmt;
        return {
          ...stmtMethods(stmt),
          bind: (...values: unknown[]) =>
            values.includes(broken)
              ? (() => {
                  throw new Error('db unavailable');
                })()
              : real.prepare(sql).bind(...values),
        };
      },
    };
    const messages = [message({ delivery_id: good1 }), message({ delivery_id: broken }), message('garbage'), message(null), message({ delivery_id: good2 })];
    const results = await handleDeliveryBatch(s.relay, messages);

    expect(messages.map((m) => [m.calls.ack, m.calls.retry])).toEqual([
      [1, []],
      [0, [{ delaySeconds: 60 }]],
      [1, []],
      [1, []],
      [1, []],
    ]);
    expect(rec.requests).toHaveLength(2);
    expect(results.filter((r) => r.outcome === 'delivered')).toHaveLength(2);
    expect(s.log.lines.some((l) => l.event === 'deliveries.message_failed')).toBe(true);
  });

  it('hands a retry back to the queue with its delay, and tells the cron scan to leave it alone until then', async () => {
    const { s, id } = await ready(reply(503));
    const m = message({ delivery_id: id });
    await handleDeliveryBatch(s.relay, [m]);
    expect(m.calls.ack).toBe(0);
    expect(m.calls.retry).toHaveLength(1);
    const delay = m.calls.retry[0]!.delaySeconds!;
    expect(delay).toBeGreaterThanOrEqual(15);
    expect(delay).toBeLessThanOrEqual(30);
    expect((await delivery(s, id)).enqueued_at).toBe(new Date(s.relay.now().getTime() + delay * 1000).toISOString());

    // Even once it is due, the scan waits 10 minutes for the queue to deliver its retry.
    const q = mockQueue();
    s.relay.queue = q.queue;
    s.advance((delay + 1) * 1000);
    expect(await drainDue(s.relay)).toBe(0);
    s.advance(10 * 60_000);
    expect(await drainDue(s.relay)).toBe(1);
  });

  it('caps retry delays at the Queues maximum of 24 hours', async () => {
    const { s, id } = await ready(reply(429, { 'retry-after': '999999' }));
    const m = message({ delivery_id: id });
    await handleDeliveryBatch(s.relay, [m]);
    expect(m.calls.retry).toEqual([{ delaySeconds: 86_400 }]);
  });

  it('acks deliveries that are done, failed or not due', async () => {
    const done = await ready();
    const failed = await ready(reply(404));
    const waiting = await ready(reply(503));
    await attemptDelivery(waiting.s.relay, waiting.id);
    for (const { s, id } of [done, failed, waiting]) {
      const m = message({ delivery_id: id });
      await handleDeliveryBatch(s.relay, [m]);
      expect(m.calls, id).toEqual({ ack: 1, retry: [] });
    }
  });
});

describe('replayDelivery', () => {
  it('refuses a row under an active lease, or waiting for its next retry', async () => {
    let release!: () => void;
    let started!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const begun = new Promise<void>((r) => (started = r));
    const { s, rec, id } = await ready();
    s.receivers[HOOK_HOST] = async (req) => {
      rec.requests.push({ headers: req.headers, body: '', redirect: req.redirect, url: req.url });
      started();
      await gate;
      return ok();
    };
    const inFlight = attemptDelivery(s.relay, id);
    await begun;

    const refused = await replayDelivery(s.relay, id, 'own_admin');
    expect(refused.outcome).toBe('skipped');
    expect(await one(s, "SELECT COUNT(*) AS n FROM audit_log WHERE action = 'delivery.replayed'")).toEqual({ n: 0 });
    release();
    expect(await inFlight).toEqual({ outcome: 'delivered' });
    expect(rec.requests).toHaveLength(1);

    // A delivery waiting out a backoff isn't replayable either.
    const waiting = await ready(reply(503));
    await attemptDelivery(waiting.s.relay, waiting.id);
    expect((await replayDelivery(waiting.s.relay, waiting.id)).outcome).toBe('skipped');
  });

  it('replays a finished delivery with the same webhook-id and audits it', async () => {
    const { s, rec, id } = await ready();
    await attemptDelivery(s.relay, id);
    s.advance(5000);
    expect(await replayDelivery(s.relay, id, 'own_admin')).toEqual({ outcome: 'delivered' });
    expect(rec.requests.map((r) => r.headers.get('webhook-id'))).toEqual([id, id]);
    expect(await delivery(s, id)).toMatchObject({ status: 'delivered', attempts: 2, attempt_limit: null });
    expect(await one(s, "SELECT actor_type, actor_id, target_type, target_id FROM audit_log WHERE action = 'delivery.replayed'")).toEqual({
      actor_type: 'admin',
      actor_id: 'own_admin',
      target_type: 'delivery',
      target_id: id,
    });
  });

  it('re-checks a dropped delivery like any attempt', async () => {
    const { s, sub, rec, id } = await ready();
    await s.db.prepare("UPDATE subscriptions SET status = 'paused' WHERE id = ?").bind(sub.id).run();
    await attemptDelivery(s.relay, id);
    expect((await delivery(s, id)).status).toBe('dropped');
    expect((await replayDelivery(s.relay, id)).outcome).toBe('dropped');
    await s.db.prepare("UPDATE subscriptions SET status = 'active' WHERE id = ?").bind(sub.id).run();
    expect(await replayDelivery(s.relay, id)).toEqual({ outcome: 'delivered' });
    expect(rec.requests).toHaveLength(1);
  });

  it('gives an exhausted delivery three more attempts', async () => {
    const { s, id } = await ready(reply(503));
    await s.db.prepare("UPDATE deliveries SET status = 'failed', attempts = 24, next_attempt_at = NULL WHERE id = ?").bind(id).run();

    expect((await replayDelivery(s.relay, id, 'own_admin')).outcome).toBe('retry');
    expect((await delivery(s, id)).attempt_limit).toBe(27);
    s.advance(7 * 3600_000);
    expect((await attemptDelivery(s.relay, id)).outcome).toBe('retry');
    s.advance(7 * 3600_000);
    expect(await attemptDelivery(s.relay, id)).toEqual({ outcome: 'failed', reason: '503 from the destination; gave up after 27 attempts' });
    expect((await delivery(s, id)).attempts).toBe(27);
  });

  it('leaves the attempt limit alone for a delivery that wasn’t exhausted', async () => {
    const { s, id } = await ready(reply(404));
    await attemptDelivery(s.relay, id);
    await replayDelivery(s.relay, id);
    expect((await delivery(s, id)).attempt_limit).toBeNull();
  });
});

describe('backoff', () => {
  it('doubles from 30 s, jittered between half and all, up to 6 hours', () => {
    expect(backoffSeconds(1, () => 0)).toBe(15);
    expect(backoffSeconds(1, () => 1)).toBe(30);
    expect(backoffSeconds(3, () => 1)).toBe(120);
    expect(backoffSeconds(20, () => 1)).toBe(21_600);
    expect(backoffSeconds(24, () => 0)).toBe(10_800);
  });
});

/** The pass-through methods of a statement, for wrapping `bind`. */
function stmtMethods(stmt: ReturnType<Setup['relay']['db']['prepare']>) {
  return { first: () => stmt.first(), all: () => stmt.all(), run: () => stmt.run() } as Pick<typeof stmt, 'first' | 'all' | 'run'>;
}
