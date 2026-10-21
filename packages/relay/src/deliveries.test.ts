import type { Digest } from '@logitland/contracts';
import { verify } from '@logitland/webhooks';
import { describe, expect, it } from 'vitest';
import { HOOK_HOST, say } from './deliveries.testkit';
import { attemptDelivery, backoffSeconds, drainDue, handleDeliveryBatch, pushDue, replayDelivery } from './services/deliveries';
import { dohResolver } from './services/destinations';
import { all, attempts, delivery, failClaimOf, hooked, mockQueue, next, ok, one, receive, reply, webhook } from './webhook.testkit';

// Webhook delivery (#11): each digest a subscription is due to give becomes one signed POST, kept in the ledger with its
// body so every retry sends the same bytes under the same webhook-id.

describe('pushing digests', () => {
  it('records each due digest as a pending delivery holding it, and hands it to the Queue', async () => {
    const { s, q, sub, id } = await hooked();
    const row = await one<{
      status: string;
      attempts: number;
      next_attempt_at: string;
      enqueued_at: string;
      subscription_id: string;
      event_count: number;
      body: string;
    }>(s, 'SELECT * FROM deliveries WHERE id = ?', id);
    expect(row).toMatchObject({
      status: 'pending',
      attempts: 0,
      next_attempt_at: s.now().toISOString(),
      enqueued_at: s.now().toISOString(),
      subscription_id: sub.id,
      event_count: 1,
    });
    expect(JSON.parse(row.body)).toMatchObject({ type: 'digest', subscription_id: sub.id, more: false, events: [{ type: 'message.created' }] });
    expect(q.deliveries).toEqual([id]);
    // Taken once: there is nothing more until something new arrives.
    expect(await pushDue(s.relay, s.agent.id)).toBe(0);
  });

  it('makes none for an agent that isn’t active or a webhook that is paused', async () => {
    for (const stop of ["UPDATE agents SET status = 'suspended' WHERE id = ?", "UPDATE agent_webhooks SET status = 'paused' WHERE agent_id = ?"]) {
      const { s } = await hooked();
      await s.db.prepare(stop).bind(s.agent.id).run();
      await say(s, 'while stopped');
      expect(await pushDue(s.relay, s.agent.id)).toBe(0);
      expect(await all(s, 'SELECT 1 FROM deliveries')).toHaveLength(1);
    }
  });

  it('keeps the delivery when the Queue fails, leaving enqueued_at empty for the cron scan', async () => {
    const { s } = await hooked();
    s.relay.queue = { send: async () => {}, sendBatch: async () => Promise.reject(new Error('Too Many Requests')) };
    const id = await next(s);
    expect((await delivery(s, id)).enqueued_at).toBeNull();
    expect(s.log.lines.some((l) => l.event === 'deliveries.enqueue_failed')).toBe(true);

    const healthy = mockQueue();
    s.relay.queue = healthy.queue;
    expect(await drainDue(s.relay)).toBe(1);
    expect(healthy.deliveries).toEqual([id]);
  });

  it('wakes the Queue for a subscription due within the minute, and the cron scan for later', async () => {
    const { s, q, sub } = await hooked();
    await s.call('PATCH', `/v1/subscriptions/${sub.id}`, { frequency: '30s' }, s.auth);
    await say(s, 'soon');
    expect(q.pushes.at(-1)).toEqual({ agent: s.agent.id, delaySeconds: 30 });
    s.advance(30_000);
    expect(await drainDue(s.relay)).toBe(1);
    expect(q.pushes.at(-1)).toEqual({ agent: s.agent.id });
  });
});

describe('a delivery attempt', () => {
  it('sends the digest it holds, signed, with the delivery ID as webhook-id', async () => {
    const { s, rec, secret, id } = await hooked();
    expect(await attemptDelivery(s.relay, id)).toEqual({ outcome: 'delivered' });
    expect(rec.requests).toHaveLength(1);
    const req = rec.requests[0]!;
    const digest = JSON.parse(req.body) as Digest;
    expect(digest.events.map((e) => e.type === 'message.created' && e.data.content)).toEqual(['hello']);
    expect(req.body).toBe((await one<{ body: string }>(s, 'SELECT body FROM deliveries WHERE id = ?', id)).body);
    expect(req.headers.get('webhook-id')).toBe(id);
    expect(req.headers.get('content-type')).toBe('application/json');
    expect(req.headers.get('authorization')).toBeNull();
    expect(req.redirect).toBe('manual');
    await expect(verify(req.headers, req.body, secret, { now: s.relay.now() })).resolves.toMatchObject({ id });

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
    const { s, rec, secret, id } = await hooked();
    const rotated = (await (await s.call('POST', '/v1/delivery/rotate-secret', undefined, s.auth)).json()) as { secret: string };

    s.advance(23 * 3600_000 + 59 * 60_000);
    await attemptDelivery(s.relay, id);
    const dual = rec.requests[0]!;
    expect(dual.headers.get('webhook-signature')!.split(' ')).toHaveLength(2);
    await expect(verify(dual.headers, dual.body, rotated.secret, { now: s.relay.now() })).resolves.toBeTruthy();
    await expect(verify(dual.headers, dual.body, secret, { now: s.relay.now() })).resolves.toBeTruthy();

    s.advance(2 * 60_000); // 24 h and 1 min after the rotation
    await attemptDelivery(s.relay, await next(s));
    const single = rec.requests[1]!;
    expect(single.headers.get('webhook-signature')!.split(' ')).toHaveLength(1);
    await expect(verify(single.headers, single.body, rotated.secret, { now: s.relay.now() })).resolves.toBeTruthy();
    await expect(verify(single.headers, single.body, secret, { now: s.relay.now() })).rejects.toThrow();
  });

  it('retries a 503 with backoff and keeps the same webhook-id and body', async () => {
    let status = 503;
    const { s, rec, id } = await hooked(() => new Response(null, { status }));
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
    expect((await webhook(s)).failure_streak).toBe(0);

    expect((await attemptDelivery(s.relay, id)).outcome).toBe('skipped'); // not due yet
    s.advance(after * 1000);
    status = 200;
    expect(await attemptDelivery(s.relay, id)).toEqual({ outcome: 'delivered' });
    expect(rec.requests.map((r) => r.headers.get('webhook-id'))).toEqual([id, id]);
    expect(rec.requests[1]!.body).toBe(rec.requests[0]!.body);
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
      const { s, id } = await hooked(reply(503, { 'retry-after': header }));
      expect(await attemptDelivery(s.relay, id), header).toEqual({ outcome: 'retry', afterSeconds: expected });
      expect((await delivery(s, id)).next_attempt_at).toBe(new Date(s.relay.now().getTime() + expected * 1000).toISOString());
    }
    const dated = await hooked(reply(429, { 'retry-after': new Date('2026-10-19T03:05:00Z').toUTCString() }));
    expect(await attemptDelivery(dated.s.relay, dated.id)).toEqual({ outcome: 'retry', afterSeconds: 300 });
    const junk = await hooked(reply(503, { 'retry-after': 'soon' }));
    const result = await attemptDelivery(junk.s.relay, junk.id);
    expect(result.outcome === 'retry' && result.afterSeconds >= 15 && result.afterSeconds <= 30).toBe(true);
  });

  it.each([429, 408, 500, 502])('retries a %i', async (status) => {
    const { s, id } = await hooked(reply(status));
    expect((await attemptDelivery(s.relay, id)).outcome).toBe('retry');
    expect((await delivery(s, id)).status).toBe('retrying');
  });

  it.each([400, 401, 404, 422])('fails a %i without retrying', async (status) => {
    const { s, id } = await hooked(reply(status));
    expect(await attemptDelivery(s.relay, id)).toEqual({ outcome: 'failed', reason: `${status} from the destination` });
    expect(await delivery(s, id)).toMatchObject({ status: 'failed', attempts: 1, last_status_code: status, next_attempt_at: null });
    expect((await webhook(s)).failure_streak).toBe(1);
  });

  it('never follows a redirect, and fails the delivery', async () => {
    const { s, rec, id } = await hooked(reply(302, { location: 'http://169.254.169.254/latest' }));
    const elsewhere: Request[] = [];
    s.receivers['169.254.169.254'] = (req) => (elsewhere.push(req), new Response(null));
    expect(await attemptDelivery(s.relay, id)).toEqual({ outcome: 'failed', reason: '302 redirect not followed' });
    expect(rec.requests).toHaveLength(1);
    expect(rec.requests[0]!.redirect).toBe('manual');
    expect(elsewhere).toHaveLength(0);
    expect((await webhook(s)).failure_streak).toBe(1);
  });

  it('disables the webhook on 410, drops what was waiting for it, and makes no more', async () => {
    const { s, id } = await hooked(reply(410));
    const second = await next(s);
    expect(await attemptDelivery(s.relay, id)).toMatchObject({ outcome: 'failed' });
    expect(await webhook(s)).toMatchObject({ status: 'disabled', failure_streak: 0 });
    expect((await webhook(s)).paused_reason).toContain('410');
    expect(await delivery(s, id)).toMatchObject({ status: 'failed', last_status_code: 410 });
    expect(await attemptDelivery(s.relay, second)).toMatchObject({ outcome: 'dropped' });
    expect(await delivery(s, second)).toMatchObject({ status: 'dropped', next_attempt_at: null });
    expect(await one(s, "SELECT actor_type, actor_id, target_id FROM audit_log WHERE action = 'webhook.disabled'")).toEqual({
      actor_type: 'system',
      actor_id: 'relay',
      target_id: s.agent.id,
    });
    await say(s, 'after the 410');
    expect(await pushDue(s.relay, s.agent.id)).toBe(0);
    expect(await (await s.call('GET', '/v1/delivery', undefined, s.auth)).json()).toMatchObject({ kind: 'webhook', status: 'disabled' });
  });

  it('retries a lost connection and a timeout with a plain reason', async () => {
    const lost = await hooked(() => Promise.reject(new TypeError('socket closed')));
    expect(await attemptDelivery(lost.s.relay, lost.id)).toMatchObject({ outcome: 'retry' });
    expect((await delivery(lost.s, lost.id)).last_error).toBe('Couldn’t connect to the destination');
    const slow = await hooked(() => Promise.reject(new DOMException('timed out', 'TimeoutError')));
    expect(await attemptDelivery(slow.s.relay, slow.id)).toMatchObject({ outcome: 'retry' });
    expect((await delivery(slow.s, slow.id)).last_error).toBe('No answer within 10 s');
  });

  it('checks the destination again before sending, without naming the address', async () => {
    const { s, rec, id } = await hooked();
    s.dns[HOOK_HOST] = ['10.1.2.3']; // rebinding after the webhook was set
    expect(await attemptDelivery(s.relay, id)).toMatchObject({ outcome: 'retry' });
    expect(rec.requests).toHaveLength(0);
    expect((await delivery(s, id)).last_error).toBe('Refused at send time: The hostname resolves to a non-public address');
    expect(JSON.stringify(await attempts(s, id))).not.toContain('10.1.2.3');

    s.dns[HOOK_HOST] = ['93.184.216.34'];
    s.relay.resolver = dohResolver((async () => Response.json({ Status: 2 })) as typeof fetch);
    s.advance(60_000);
    expect(await attemptDelivery(s.relay, id)).toMatchObject({ outcome: 'retry' });
    expect((await delivery(s, id)).last_error).toContain('looked up');
    expect(rec.requests).toHaveLength(0);
  });

  it('records an unexpected error as an attempt with a generic message, and retries it', async () => {
    const { s, rec, id } = await hooked();
    s.relay.resolver = {
      resolve: async () => {
        throw new Error('boom: 10.0.0.1 hunter2');
      },
    };
    expect((await attemptDelivery(s.relay, id)).outcome).toBe('retry');
    expect(await delivery(s, id)).toMatchObject({ status: 'retrying', attempts: 1, last_status_code: null, last_error: 'Internal error while delivering' });
    expect((await delivery(s, id)).next_attempt_at).not.toBeNull();
    expect(await attempts(s, id)).toEqual([{ n: 1, status_code: null, error: 'Internal error while delivering' }]);
    expect(rec.requests).toHaveLength(0);
    expect(s.log.lines.some((l) => l.event === 'delivery.attempt_crashed')).toBe(true);
    expect((await webhook(s)).failure_streak).toBe(0);

    // At the attempt limit it fails instead of retrying, and counts as one failed delivery.
    await s.db.prepare('UPDATE deliveries SET attempts = 23, next_attempt_at = ? WHERE id = ?').bind(s.relay.now().toISOString(), id).run();
    expect(await attemptDelivery(s.relay, id)).toEqual({ outcome: 'failed', reason: 'Internal error while delivering; gave up after 24 attempts' });
    expect((await webhook(s)).failure_streak).toBe(1);
  });

  it('is claimed by one worker at a time', async () => {
    const { s, rec, id } = await hooked();
    const results = await Promise.all([attemptDelivery(s.relay, id), attemptDelivery(s.relay, id)]);
    expect(results.map((r) => r.outcome).sort()).toEqual(['delivered', 'skipped']);
    expect(rec.requests).toHaveLength(1);
    expect((await delivery(s, id)).attempts).toBe(1);
  });

  it.each([
    ['the webhook is paused', "UPDATE agent_webhooks SET status = 'paused' WHERE agent_id = ?"],
    ['the agent is off', "UPDATE agents SET status = 'off' WHERE id = ?"],
  ])('waits an hour without spending an attempt while %s', async (_name, stop) => {
    const { s, rec, id } = await hooked();
    await s.db.prepare(stop).bind(s.agent.id).run();
    expect((await attemptDelivery(s.relay, id)).outcome).toBe('skipped');
    expect(await delivery(s, id)).toMatchObject({ status: 'pending', attempts: 0, next_attempt_at: new Date(s.now().getTime() + 3_600_000).toISOString() });
    expect(rec.requests).toHaveLength(0);
    expect(await attempts(s, id)).toEqual([]);
  });

  it('drops the delivery when the webhook is gone by the time of the attempt', async () => {
    const { s, rec, id } = await hooked();
    // Removed through the database: DELETE /v1/delivery drops what is waiting itself.
    await s.db.prepare('DELETE FROM agent_webhooks WHERE agent_id = ?').bind(s.agent.id).run();
    expect(await attemptDelivery(s.relay, id)).toEqual({ outcome: 'dropped', reason: 'The webhook was removed or disabled' });
    expect(await delivery(s, id)).toMatchObject({ status: 'dropped', attempts: 1, next_attempt_at: null });
    expect(rec.requests).toHaveLength(0);
  });
});

describe('the failure streak', () => {
  it('counts failed deliveries, not attempts, and resets on success', async () => {
    let status = 503;
    const { s, id } = await hooked(() => new Response(null, { status }));
    for (let i = 0; i < 4; i++) {
      await attemptDelivery(s.relay, id);
      s.advance(7 * 3600_000);
      // Not what is under test here: the pause after a day of failing has its own tests.
      await s.db.prepare('UPDATE agent_webhooks SET failing_since = NULL').run();
    }
    expect((await delivery(s, id)).attempts).toBe(4);
    expect((await webhook(s)).failure_streak).toBe(0);

    status = 400;
    const bad = [await next(s), await next(s)];
    for (const [i, d] of bad.entries()) {
      await attemptDelivery(s.relay, d);
      expect((await webhook(s)).failure_streak).toBe(i + 1);
    }
    status = 200;
    expect(await attemptDelivery(s.relay, id)).toEqual({ outcome: 'delivered' });
    expect((await webhook(s)).failure_streak).toBe(0);
  });

  it('counts a delivery that runs out of attempts once', async () => {
    const { s, id } = await hooked(reply(503));
    let last;
    for (let i = 0; i < 24; i++) {
      last = await attemptDelivery(s.relay, id);
      s.advance(7 * 3600_000);
      await s.db.prepare('UPDATE agent_webhooks SET failing_since = NULL').run();
    }
    expect(last).toEqual({ outcome: 'failed', reason: '503 from the destination; gave up after 24 attempts' });
    expect(await delivery(s, id)).toMatchObject({ status: 'failed', attempts: 24, next_attempt_at: null });
    expect(await attempts(s, id)).toHaveLength(24);
    expect((await webhook(s)).failure_streak).toBe(1);
  });

  it('pauses the webhook at 50 failed deliveries; the rest wait, and go out once it is resumed', async () => {
    let status = 400;
    const { s, rec, id } = await hooked(() => new Response(null, { status }));
    const ids = [id];
    for (let i = 1; i < 53; i++) ids.push(await next(s));
    for (const d of ids.slice(0, 49)) await attemptDelivery(s.relay, d);
    expect(await webhook(s)).toMatchObject({ status: 'active', failure_streak: 49 });

    await attemptDelivery(s.relay, ids[49]!);
    expect(await webhook(s)).toMatchObject({ status: 'paused', failure_streak: 50, paused_at: s.relay.now().toISOString() });
    expect((await webhook(s)).paused_reason).toContain('50');
    expect(await one(s, "SELECT actor_type, target_id FROM audit_log WHERE action = 'webhook.paused'")).toEqual({
      actor_type: 'system',
      target_id: s.agent.id,
    });
    for (const d of ids.slice(50)) {
      expect((await attemptDelivery(s.relay, d)).outcome).toBe('skipped');
      expect(await delivery(s, d)).toMatchObject({ status: 'pending', attempts: 0 });
    }
    expect(rec.requests).toHaveLength(50);
    expect(await (await s.call('GET', '/v1/delivery', undefined, s.auth)).json()).toMatchObject({ status: 'paused', failure_streak: 50 });

    // Resuming starts afresh: the streak is zero and what waited is sent.
    expect((await s.call('POST', '/v1/delivery/resume', undefined, s.auth)).status).toBe(200);
    expect(await webhook(s)).toMatchObject({ status: 'active', failure_streak: 0, paused_reason: null });
    status = 200;
    s.advance(3_600_000);
    for (const d of ids.slice(50)) expect(await attemptDelivery(s.relay, d)).toEqual({ outcome: 'delivered' });
  });
});

describe('what an agent sees of its deliveries', () => {
  it('lists them newest first with every attempt, in pages', async () => {
    let status = 503;
    const { s, id } = await hooked(() => new Response(null, { status }));
    await attemptDelivery(s.relay, id);
    s.advance(60_000);
    status = 200;
    await attemptDelivery(s.relay, id);
    s.advance(1000);
    const second = await next(s);

    type Page = {
      deliveries: { id: string; status: string; attempts: number; attempt_log: { n: number; status_code: number | null }[] }[];
      next_before: string | null;
    };
    const get = async (q = '') => (await (await s.call('GET', `/v1/delivery/deliveries${q}`, undefined, s.auth)).json()) as Page;
    const page = await get();
    expect(page.deliveries.map((d) => d.id)).toEqual([second, id]);
    const first = page.deliveries.find((d) => d.id === id)!;
    expect(first).toMatchObject({ status: 'delivered', attempts: 2 });
    expect(first.attempt_log.map((a) => [a.n, a.status_code])).toEqual([
      [1, 503],
      [2, 200],
    ]);
    for (const hidden of ['url_host', 'agent_id', 'agent_name']) expect(first).not.toHaveProperty(hidden);
    expect(page.deliveries.find((d) => d.id === second)!.attempt_log).toEqual([]);
    expect(page.next_before).toBeNull();

    const one_ = await get('?limit=1');
    expect(one_.deliveries).toHaveLength(1);
    expect(one_.next_before).toBe(one_.deliveries[0]!.id);
    expect((await get(`?limit=1&before=${one_.next_before}`)).deliveries.map((d) => d.id)).toEqual([id]);
    expect((await get('?status=delivered')).deliveries.map((d) => d.id)).toEqual([id]);
    expect((await s.call('GET', '/v1/delivery/deliveries?status=nope', undefined, s.auth)).status).toBe(400);
  });
});

describe('drainDue', () => {
  it('without a queue, attempts due deliveries itself, 100 a run, skipping rows that aren’t due', async () => {
    const { s, rec, id } = await hooked();
    for (let i = 0; i < 119; i++) await next(s);
    const waiting = await next(s);
    await s.db
      .prepare("UPDATE deliveries SET status = 'retrying', next_attempt_at = ? WHERE id = ?")
      .bind(new Date(s.relay.now().getTime() + 3600_000).toISOString(), waiting)
      .run();
    s.relay.queue = null;

    expect(await drainDue(s.relay)).toBe(100);
    expect(rec.requests).toHaveLength(100);
    expect(await one(s, "SELECT COUNT(*) AS n FROM deliveries WHERE status = 'delivered'")).toEqual({ n: 100 });
    expect(await drainDue(s.relay)).toBe(20);
    expect(await drainDue(s.relay)).toBe(0);
    expect((await delivery(s, waiting)).status).toBe('retrying');
    expect((await delivery(s, id)).status).toBe('delivered');
  });

  it('without a queue, one row that throws doesn’t stop the others', async () => {
    const { s, rec, id } = await hooked();
    const other = await next(s);
    s.relay.queue = null;
    failClaimOf(s, id);
    expect(await drainDue(s.relay)).toBe(2);
    expect(rec.requests).toHaveLength(1);
    expect((await delivery(s, other)).status).toBe('delivered');
    expect((await delivery(s, id)).status).toBe('pending');
    expect(s.log.lines.some((l) => l.event === 'deliveries.drain_failed')).toBe(true);
  });

  it('with a queue, re-enqueues only rows never enqueued or enqueued over 10 minutes ago, and not twice', async () => {
    const { s, q, rec, id: fresh } = await hooked();
    expect(q.deliveries).toEqual([fresh]);

    expect(await drainDue(s.relay)).toBe(0);
    s.advance(9 * 60_000);
    expect(await drainDue(s.relay)).toBe(0);

    s.advance(2 * 60_000); // 11 minutes since it was enqueued
    expect(await drainDue(s.relay)).toBe(1);
    expect(q.deliveries).toEqual([fresh, fresh]);
    expect((await delivery(s, fresh)).enqueued_at).toBe(s.relay.now().toISOString());
    expect(await drainDue(s.relay)).toBe(0);
    expect(q.deliveries).toHaveLength(2);
    expect(rec.requests).toHaveLength(0); // the queue consumer attempts; the cron scan doesn’t

    // Never enqueued (the earlier enqueue failed): picked up at once. Not due yet: left alone.
    const unsent = await next(s);
    await s.db.prepare('UPDATE deliveries SET enqueued_at = NULL WHERE id = ?').bind(unsent).run();
    const later = await next(s);
    await s.db
      .prepare("UPDATE deliveries SET enqueued_at = NULL, status = 'retrying', next_attempt_at = ? WHERE id = ?")
      .bind(new Date(s.relay.now().getTime() + 3600_000).toISOString(), later)
      .run();
    expect(await drainDue(s.relay)).toBe(1);
    expect(q.deliveries.at(-1)).toBe(unsent);
    expect((await delivery(s, later)).enqueued_at).toBeNull();
  });

  it('with a queue, takes 100 a run and uses sendBatch or send', async () => {
    for (const withBatch of [true, false]) {
      const { s } = await hooked();
      for (let i = 0; i < 119; i++) await next(s);
      s.advance(11 * 60_000);
      const q = mockQueue(withBatch);
      s.relay.queue = q.queue;
      expect(await drainDue(s.relay)).toBe(100);
      expect(await drainDue(s.relay)).toBe(20);
      expect(q.deliveries).toHaveLength(120);
      expect(q.batches).toEqual(withBatch ? [100, 20] : []);
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
    const { s, q, rec, id: good1 } = await hooked();
    const good2 = await next(s);
    const broken = await next(s);
    await say(s, 'due for a push');
    failClaimOf(s, broken);
    const messages = [
      message({ delivery_id: good1 }),
      message({ delivery_id: broken }),
      message('garbage'),
      message(null),
      message({ delivery_id: good2 }),
      message({ push: s.agent.id }),
    ];
    const results = await handleDeliveryBatch(s.relay, messages);

    expect(messages.map((m) => [m.calls.ack, m.calls.retry])).toEqual([
      [1, []],
      [0, [{ delaySeconds: 60 }]],
      [1, []],
      [1, []],
      [1, []],
      [1, []],
    ]);
    expect(rec.requests).toHaveLength(2);
    expect(results.filter((r) => r.outcome === 'delivered')).toHaveLength(2);
    expect(s.log.lines.some((l) => l.event === 'deliveries.message_failed')).toBe(true);
    // The push took the due digest into a new delivery, handed to the Queue.
    expect(q.deliveries).toHaveLength(4);
  });

  it('hands a retry back to the queue with its delay, and tells the cron scan to leave it alone until then', async () => {
    const { s, id } = await hooked(reply(503));
    const m = message({ delivery_id: id });
    await handleDeliveryBatch(s.relay, [m]);
    expect(m.calls.ack).toBe(0);
    expect(m.calls.retry).toHaveLength(1);
    const delay = m.calls.retry[0]!.delaySeconds!;
    expect(delay).toBeGreaterThanOrEqual(15);
    expect(delay).toBeLessThanOrEqual(30);
    expect((await delivery(s, id)).enqueued_at).toBe(new Date(s.relay.now().getTime() + delay * 1000).toISOString());

    // Even once it is due, the scan waits 10 minutes for the queue to deliver its retry.
    s.advance((delay + 1) * 1000);
    expect(await drainDue(s.relay)).toBe(0);
    s.advance(10 * 60_000);
    expect(await drainDue(s.relay)).toBe(1);
  });

  it('caps retry delays at the Queues maximum of 24 hours', async () => {
    const { s, id } = await hooked(reply(429, { 'retry-after': '999999' }));
    const m = message({ delivery_id: id });
    await handleDeliveryBatch(s.relay, [m]);
    expect(m.calls.retry).toEqual([{ delaySeconds: 86_400 }]);
  });

  it('acks deliveries that are done, failed or not due', async () => {
    const done = await hooked();
    const failed = await hooked(reply(404));
    const waiting = await hooked(reply(503));
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
    const { s, id } = await hooked();
    const rec = receive(s, async () => {
      started();
      await gate;
      return ok(new Request('https://x'));
    });
    const inFlight = attemptDelivery(s.relay, id);
    await begun;

    expect((await replayDelivery(s.relay, id, 'own_admin')).outcome).toBe('skipped');
    expect(await one(s, "SELECT COUNT(*) AS n FROM audit_log WHERE action = 'delivery.replayed'")).toEqual({ n: 0 });
    release();
    expect(await inFlight).toEqual({ outcome: 'delivered' });
    expect(rec.requests).toHaveLength(1);

    // A delivery waiting out a backoff isn't replayable either.
    const waiting = await hooked(reply(503));
    await attemptDelivery(waiting.s.relay, waiting.id);
    expect((await replayDelivery(waiting.s.relay, waiting.id)).outcome).toBe('skipped');
  });

  it('replays a finished delivery with the same webhook-id and audits it', async () => {
    const { s, rec, id } = await hooked();
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
    const { s, rec, id } = await hooked();
    expect((await s.call('DELETE', '/v1/delivery', undefined, s.auth)).status).toBe(204);
    expect((await delivery(s, id)).status).toBe('dropped');
    expect((await replayDelivery(s.relay, id)).outcome).toBe('dropped');
    expect((await s.call('PUT', '/v1/delivery', { url: `https://${HOOK_HOST}/logitland` }, s.auth)).status).toBe(200);
    expect(await replayDelivery(s.relay, id)).toEqual({ outcome: 'delivered' });
    expect(rec.requests).toHaveLength(1);
  });

  it('gives an exhausted delivery three more attempts', async () => {
    const { s, id } = await hooked(reply(503));
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
    const { s, id } = await hooked(reply(404));
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
