import { describe, expect, it } from 'vitest';
import { contents, poll, say } from './deliveries.testkit';
import { readFeed, type SubscriptionRow } from './services/feed';
import { attemptDelivery, backoffSeconds, drainDue, handleDeliveryBatch, pushDue } from './services/deliveries';
import { LOUNGE } from './testing';
import { all, delivery, hooked, next, receive, reply, webhook } from './webhook.testkit';

describe('what a receiver can ask for', () => {
  it('Retry-After can only slow the retries down, never below the backoff', async () => {
    const { s, id } = await hooked(reply(503, { 'retry-after': '1' }));
    const before = s.relay.now().getTime();
    expect(await attemptDelivery(s.relay, id)).toMatchObject({ outcome: 'retry' });
    const wait = (Date.parse((await delivery(s, id)).next_attempt_at!) - before) / 1000;
    expect(wait).toBeGreaterThanOrEqual(backoffSeconds(1, () => 0));
  });

  it('a longer Retry-After still wins', async () => {
    const { s, id } = await hooked(reply(503, { 'retry-after': '3600' }));
    const before = s.relay.now().getTime();
    await attemptDelivery(s.relay, id);
    expect((Date.parse((await delivery(s, id)).next_attempt_at!) - before) / 1000).toBeGreaterThanOrEqual(3600);
  });
});

describe('a destination that stays down', () => {
  it('pauses the webhook after a day without a success, and says why once', async () => {
    const { s, id } = await hooked(reply(503));
    await attemptDelivery(s.relay, id);
    expect(await webhook(s)).toMatchObject({ status: 'active', failing_since: s.now().toISOString() });

    s.advance(25 * 3_600_000);
    await attemptDelivery(s.relay, id);
    expect(await webhook(s)).toMatchObject({ status: 'paused', failure_streak: 0 });
    expect((await webhook(s)).paused_reason).toContain('24 hours');
    // The delivery itself is kept for when the webhook is resumed.
    expect((await delivery(s, id)).status).toBe('retrying');
    expect(await all(s, "SELECT target_id FROM audit_log WHERE action = 'webhook.paused'")).toEqual([{ target_id: s.agent.id }]);
  });

  it('forgets the run when a delivery succeeds', async () => {
    let status = 503;
    const { s, id } = await hooked(() => new Response(null, { status }));
    await attemptDelivery(s.relay, id);
    expect((await webhook(s)).failing_since).not.toBeNull();
    status = 200;
    s.advance(60 * 60_000);
    expect(await attemptDelivery(s.relay, id)).toEqual({ outcome: 'delivered' });
    expect((await webhook(s)).failing_since).toBeNull();
  });

  it('leaves what comes while the webhook is paused in the subscription, for GET /v1/events', async () => {
    const { s } = await hooked();
    await s.db.prepare("UPDATE agent_webhooks SET status = 'paused' WHERE agent_id = ?").bind(s.agent.id).run();
    await say(s, 'while paused');
    expect(await pushDue(s.relay, s.agent.id)).toBe(0);
    expect((await poll(s)).digests.map(contents)).toEqual([['while paused']]);
  });
});

describe('a delivery that is dropped while its attempt runs', () => {
  it('stays dropped, and the late answer changes nothing about the webhook', async () => {
    const { s, id } = await hooked();
    receive(s, async () => {
      // The webhook is replaced while the request is in flight: what was waiting for the old one is dropped.
      await s.db.prepare("UPDATE deliveries SET status = 'dropped' WHERE id = ?").bind(id).run();
      return new Response(null, { status: 503 });
    });
    expect(await attemptDelivery(s.relay, id)).toMatchObject({ outcome: 'skipped' });
    expect(await delivery(s, id)).toMatchObject({ status: 'dropped' });
    expect(await webhook(s)).toMatchObject({ status: 'active', failure_streak: 0, failing_since: null });
    expect(await all(s, 'SELECT n FROM delivery_attempts WHERE delivery_id = ?', id)).toHaveLength(1);
  });
});

describe('a Queue batch', () => {
  it('works its deliveries at the same time, so one slow receiver does not hold up the rest', async () => {
    const { s, id } = await hooked();
    const ids = [id];
    for (let i = 0; i < 9; i++) ids.push(await next(s));
    receive(s, async () => {
      await new Promise((resolve) => setTimeout(resolve, 300));
      return new Response(null, { status: 200 });
    });
    const acked: string[] = [];
    const messages = ids.map((d) => ({ body: { delivery_id: d }, ack: () => void acked.push(d), retry() {} }));
    const started = Date.now();
    const results = await handleDeliveryBatch(s.relay, messages);
    expect(Date.now() - started).toBeLessThan(1_500);
    expect(results.map((r) => r.outcome)).toEqual(Array(10).fill('delivered'));
    expect(acked.sort()).toEqual([...ids].sort());
  });
});

describe('the cron drain', () => {
  it('takes pending and retrying deliveries together, oldest due first', async () => {
    const { s, q, id: a } = await hooked();
    const b = await next(s);
    const c = await next(s);
    const at = (minutes: number) => new Date(s.relay.now().getTime() - minutes * 60_000).toISOString();
    await s.db.prepare('UPDATE deliveries SET enqueued_at = NULL').run();
    await s.db.prepare('UPDATE deliveries SET next_attempt_at = ? WHERE id = ?').bind(at(1), a).run();
    await s.db.prepare("UPDATE deliveries SET status = 'retrying', next_attempt_at = ? WHERE id = ?").bind(at(2), b).run();
    await s.db.prepare('UPDATE deliveries SET next_attempt_at = ? WHERE id = ?').bind(at(3), c).run();
    q.deliveries.length = 0;
    expect(await drainDue(s.relay)).toBe(3);
    expect(q.deliveries).toEqual([c, b, a]);
  });
});

describe('resuming the webhook', () => {
  it('is limited to six times a day', async () => {
    const { s } = await hooked();
    const pause = () =>
      s.db.prepare("UPDATE agent_webhooks SET status = 'paused', paused_at = ? WHERE agent_id = ?").bind(s.now().toISOString(), s.agent.id).run();
    for (let i = 0; i < 6; i++) {
      await pause();
      expect((await s.call('POST', '/v1/delivery/resume', undefined, s.auth)).status).toBe(200);
    }
    await pause();
    const res = await s.call('POST', '/v1/delivery/resume', undefined, s.auth);
    expect(res.status).toBe(429);
    expect(Number(res.headers.get('retry-after'))).toBeGreaterThan(0);
  });
});

describe('query plans', () => {
  const plan = (s: Awaited<ReturnType<typeof hooked>>['s'], sql: string, ...args: unknown[]) =>
    s.db.raw
      .prepare(`EXPLAIN QUERY PLAN ${sql}`)
      .all(...(args as never[]))
      .map((r) => String((r as { detail: string }).detail))
      .join(' | ');

  it('list a forum’s open threads through the partial index', async () => {
    const { s } = await hooked();
    const p = plan(s, 'SELECT t.id FROM threads t WHERE t.parent_id = ? AND t.deleted_at IS NULL AND t.archived = 0 ORDER BY t.id DESC LIMIT 50', LOUNGE);
    expect(p).toContain('threads_open');
  });

  it('read a subscription’s feed through an index on the log, whatever its kind', async () => {
    const { s, sub } = await hooked();
    expect((await s.call('POST', '/v1/subscriptions', { kind: 'replies' }, s.auth)).status).toBe(201);
    const sql: string[] = [];
    const real = s.relay.db;
    s.relay.db = { batch: (x) => real.batch(x), prepare: (text) => (sql.push(text), real.prepare(text)) };
    for (const row of await all<SubscriptionRow>(s, 'SELECT * FROM subscriptions WHERE agent_id = ?', s.agent.id)) await readFeed(s.relay, row, 0, 100);
    s.relay.db = real;
    const reads = sql.filter((q) => q.startsWith('SELECT e.seq, e.payload FROM events e'));
    expect(reads).toHaveLength(2);
    const plans = reads.map((q) => plan(s, q, ...Array(q.split('?').length - 1).fill(sub.id)));
    for (const p of plans) expect(p).not.toMatch(/SCAN e\b/);
    // A channel's events by channel; the replies by the agent they are addressed to, or whose message they answer.
    for (const index of ['events_channel', 'events_for_agent', 'events_replies']) expect(plans.join(' | ')).toContain(index);
  });
});
