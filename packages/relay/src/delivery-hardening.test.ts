import { newId } from '@logitland/contracts';
import { describe, expect, it } from 'vitest';
import { all, HOOK_HOST, insertEvent, one, publish, recorder, setup, subscribe, subscribeRaw, type Setup } from './deliveries.testkit';
import { attemptDelivery, backoffSeconds, drainDue, handleDeliveryBatch } from './services/deliveries';
import { refund } from './services/limits';
import { updateSettings } from './services/settings';
import { ADMIN_DISCORD, LOUNGE, seedAgent, seedOwner } from './testing';
import type { SqliteD1 } from './testing/sqlite-d1';

const ok = () => new Response(null, { status: 200 });
const reply =
  (status: number, headers: Record<string, string> = {}) =>
  () =>
    new Response(null, { status, headers });

/** A subscribed agent, a recording receiver and one pending delivery. */
async function ready(answer: () => Response | Promise<Response> = ok) {
  const s = await setup();
  const sub = await subscribe(s);
  const rec = recorder(answer);
  s.receivers[HOOK_HOST] = rec.handler;
  const { event, ids } = await publish(s);
  return { s, sub, rec, event, id: ids[0]! };
}

const delivery = (s: Setup, id: string) =>
  one<{ status: string; attempts: number; next_attempt_at: string | null; last_error: string | null }>(
    s,
    'SELECT status, attempts, next_attempt_at, last_error FROM deliveries WHERE id = ?',
    id,
  );
const subscription = (s: Setup, id: string) =>
  one<{ status: string; failure_streak: number; failing_since: string | null; paused_reason: string | null }>(
    s,
    'SELECT status, failure_streak, failing_since, paused_reason FROM subscriptions WHERE id = ?',
    id,
  );

const removal = (s: Setup) => publish(s, { type: 'message.deleted', data: { message_id: '310000000000009999', removed_by: 'author' } });

describe('what a receiver can ask for', () => {
  it('Retry-After can only slow the retries down, never below the backoff', async () => {
    const { s, id } = await ready(reply(503, { 'retry-after': '1' }));
    const before = s.relay.now().getTime();
    expect(await attemptDelivery(s.relay, id)).toMatchObject({ outcome: 'retry' });
    const wait = (Date.parse((await delivery(s, id)).next_attempt_at!) - before) / 1000;
    expect(wait).toBeGreaterThanOrEqual(backoffSeconds(1, () => 0));
  });

  it('a longer Retry-After still wins', async () => {
    const { s, id } = await ready(reply(503, { 'retry-after': '3600' }));
    const before = s.relay.now().getTime();
    await attemptDelivery(s.relay, id);
    expect((Date.parse((await delivery(s, id)).next_attempt_at!) - before) / 1000).toBeGreaterThanOrEqual(3600);
  });
});

describe('a destination that stays down', () => {
  it('pauses the subscription after a day without a success, and says why once', async () => {
    const { s, sub, id } = await ready(reply(503));
    await attemptDelivery(s.relay, id);
    expect((await subscription(s, sub.id)).failing_since).not.toBeNull();
    expect((await subscription(s, sub.id)).status).toBe('active');

    s.advance(25 * 3_600_000);
    await attemptDelivery(s.relay, id);
    expect(await subscription(s, sub.id)).toMatchObject({ status: 'paused', failure_streak: 0 });
    expect((await subscription(s, sub.id)).paused_reason).toContain('24 hours');
    expect((await delivery(s, id)).status).toBe('dropped');
    expect(await all(s, "SELECT target_id FROM audit_log WHERE action = 'subscription.paused'")).toEqual([{ target_id: sub.id }]);
  });

  it('forgets the run when a delivery succeeds', async () => {
    let status = 503;
    const { s, sub, id } = await ready(() => new Response(null, { status }));
    await attemptDelivery(s.relay, id);
    expect((await subscription(s, sub.id)).failing_since).not.toBeNull();
    status = 200;
    s.advance(60 * 60_000);
    expect(await attemptDelivery(s.relay, id)).toEqual({ outcome: 'delivered' });
    expect((await subscription(s, sub.id)).failing_since).toBeNull();
  });

  it('keeps pending removal notices when it pauses, and sends them to the paused subscription', async () => {
    const { s, sub, rec, id } = await ready(reply(503));
    const gone = (await removal(s)).ids[0]!;
    await attemptDelivery(s.relay, id);
    s.advance(25 * 3_600_000);
    await attemptDelivery(s.relay, id);
    expect((await subscription(s, sub.id)).status).toBe('paused');
    expect((await delivery(s, id)).status).toBe('dropped');
    expect((await delivery(s, gone)).status).toBe('pending');

    // A removal published after the pause still reaches it; other events do not.
    expect((await publish(s)).ids).toEqual([]);
    const later = (await removal(s)).ids;
    expect(later).toHaveLength(1);
    const answered = recorder(ok);
    s.receivers[HOOK_HOST] = answered.handler;
    expect(await attemptDelivery(s.relay, later[0]!)).toEqual({ outcome: 'delivered' });
    expect(JSON.parse(answered.requests[0]!.body).type).toBe('message.deleted');
    expect(rec.requests.length).toBeGreaterThan(0);
  });
});

describe('removal notices', () => {
  it('are delivered after the channel closed to agents, and other events are not', async () => {
    const { s, sub, rec } = await ready();
    const gone = (await removal(s)).ids[0]!;
    const text = (await publish(s)).ids[0]!;
    await s.db.prepare("UPDATE channels SET agent_access = 'off' WHERE id = ?").bind(LOUNGE).run();
    expect(await attemptDelivery(s.relay, gone)).toEqual({ outcome: 'delivered' });
    expect(await attemptDelivery(s.relay, text)).toMatchObject({ outcome: 'dropped', reason: 'The channel is no longer open to agents' });
    expect(rec.requests.map((r) => JSON.parse(r.body).type)).toEqual(['message.deleted']);
    expect((await subscription(s, sub.id)).status).toBe('active');
  });

  it('are delivered after the agent lost messages:read', async () => {
    const { s, rec } = await ready();
    const gone = (await removal(s)).ids[0]!;
    await s.db.prepare("UPDATE agents SET scopes = '[]' WHERE id = ?").bind(s.agent.id).run();
    expect(await attemptDelivery(s.relay, gone)).toEqual({ outcome: 'delivered' });
    expect(rec.requests).toHaveLength(1);
  });
});

describe('a delivery that is dropped while its attempt runs', () => {
  it('stays dropped, and the late answer changes nothing about the subscription', async () => {
    const s = await setup();
    const sub = await subscribe(s);
    const { ids } = await publish(s);
    s.receivers[HOOK_HOST] = async () => {
      // The author leaves while the request is in flight: the scrub drops the delivery.
      await s.db.prepare("UPDATE deliveries SET status = 'dropped' WHERE id = ?").bind(ids[0]!).run();
      return new Response(null, { status: 503 });
    };
    expect(await attemptDelivery(s.relay, ids[0]!)).toMatchObject({ outcome: 'skipped' });
    expect(await delivery(s, ids[0]!)).toMatchObject({ status: 'dropped' });
    expect(await subscription(s, sub.id)).toMatchObject({ status: 'active', failure_streak: 0, failing_since: null });
    expect((await all<{ n: number }>(s, 'SELECT n FROM delivery_attempts WHERE delivery_id = ?', ids[0]!)).length).toBe(1);
  });
});

describe('a Queue batch', () => {
  it('works its deliveries at the same time, so one slow receiver does not hold up the rest', async () => {
    const s = await setup();
    await subscribe(s);
    s.receivers[HOOK_HOST] = recorder(async () => {
      await new Promise((resolve) => setTimeout(resolve, 300));
      return new Response(null, { status: 200 });
    }).handler;
    const ids: string[] = [];
    for (let i = 0; i < 10; i++) ids.push(...(await publish(s)).ids);
    const acked: string[] = [];
    const messages = ids.map((id) => ({ body: { delivery_id: id }, ack: () => void acked.push(id), retry() {} }));
    const started = Date.now();
    const results = await handleDeliveryBatch(s.relay, messages);
    expect(Date.now() - started).toBeLessThan(1_500);
    expect(results.map((r) => r.outcome)).toEqual(Array(10).fill('delivered'));
    expect(acked.sort()).toEqual([...ids].sort());
  });
});

describe('the cron drain', () => {
  it('takes pending and retrying deliveries together, oldest due first', async () => {
    const { s, ids, retrying } = await (async () => {
      const s = await setup();
      await subscribe(s);
      const a = (await publish(s)).ids[0]!;
      const b = (await publish(s)).ids[0]!;
      const c = (await publish(s)).ids[0]!;
      const at = (minutes: number) => new Date(s.relay.now().getTime() - minutes * 60_000).toISOString();
      await s.db.prepare('UPDATE deliveries SET next_attempt_at = ? WHERE id = ?').bind(at(3), a).run();
      await s.db.prepare("UPDATE deliveries SET status = 'retrying', next_attempt_at = ? WHERE id = ?").bind(at(2), b).run();
      await s.db.prepare('UPDATE deliveries SET next_attempt_at = ? WHERE id = ?').bind(at(1), c).run();
      return { s, ids: [a, b, c], retrying: b };
    })();
    const sent: string[] = [];
    s.relay.queue = { send: async (m: { delivery_id: string }) => void sent.push(m.delivery_id) };
    expect(await drainDue(s.relay)).toBe(3);
    expect(sent).toEqual(ids);
    expect(ids[1]).toBe(retrying);
  });
});

describe('creating and resuming subscriptions', () => {
  it('are refused while deliveries are switched off, without contacting the destination', async () => {
    const s = await setup();
    const admin = await seedOwner(s.relay, ADMIN_DISCORD, 'admin');
    await updateSettings(s.relay, admin.id, { deliveries_paused: true });
    const rec = recorder(async (req) => Response.json({ challenge: ((await req.json()) as { challenge: string }).challenge }));
    s.receivers[HOOK_HOST] = rec.handler;
    const res = await subscribeRaw(s);
    expect(res.status).toBe(503);
    expect(((await res.json()) as { code: string }).code).toBe('unavailable');
    expect(rec.requests).toEqual([]);
  });

  const fill = async (s: Setup, n: number, channel: (i: number) => string) => {
    const filler = await seedAgent(s.relay, { name: 'Filler' });
    const at = s.relay.now().toISOString();
    const stmts = Array.from({ length: n }, (_, i) => {
      const id = newId('subscription');
      return [
        s.relay.db
          .prepare(
            "INSERT INTO subscriptions (id, agent_id, url_ciphertext, url_host, events, channel_ids, secret_ciphertext, status, created_at) VALUES (?, ?, 'x', ?, '[\"message.created\"]', '[]', 'x', 'active', ?)",
          )
          .bind(id, filler.id, `h${i}.example.org`, at),
        s.relay.db.prepare('INSERT INTO subscription_channels (subscription_id, channel_id) VALUES (?, ?)').bind(id, channel(i)),
      ];
    }).flat();
    for (let i = 0; i < stmts.length; i += 500) await s.relay.db.batch(stmts.slice(i, i + 500));
  };

  it('stop at a ceiling per channel', async () => {
    const s = await setup();
    await fill(s, 300, () => LOUNGE);
    const res = await subscribeRaw(s);
    expect(res.status).toBe(503);
    expect(((await res.json()) as { detail: string }).detail).toContain('GET /v1/events');
  });

  it('stop at a ceiling for the whole relay', async () => {
    const s = await setup();
    await fill(s, 2000, (i) => `9${String(i % 100).padStart(17, '0')}`);
    expect((await subscribeRaw(s)).status).toBe(503);
  });

  it('limit how often one subscription is resumed in a day', async () => {
    const s = await setup();
    const sub = await subscribe(s);
    const pause = () => s.db.prepare("UPDATE subscriptions SET status = 'paused', paused_at = ? WHERE id = ?").bind(s.relay.now().toISOString(), sub.id).run();
    for (let i = 0; i < 6; i++) {
      await pause();
      expect((await s.call('POST', `/v1/subscriptions/${sub.id}/resume`, undefined, s.auth)).status).toBe(200);
    }
    await pause();
    const res = await s.call('POST', `/v1/subscriptions/${sub.id}/resume`, undefined, s.auth);
    expect(res.status).toBe(429);
    expect(Number(res.headers.get('retry-after'))).toBeGreaterThan(0);
  });

  it('address the gap after a resume to that subscription alone', async () => {
    const s = await setup();
    const mine = await subscribe(s);
    const other = await seedAgent(s.relay, { name: 'Bystander' });
    const theirs = await subscribe(s, {}, s.as(other.token));
    await s.db.prepare("UPDATE subscriptions SET status = 'paused', paused_at = ? WHERE id = ?").bind(s.relay.now().toISOString(), mine.id).run();
    s.advance(60_000);
    expect((await s.call('POST', `/v1/subscriptions/${mine.id}/resume`, undefined, s.auth)).status).toBe(200);

    const gaps = await all<{ subscription_id: string }>(s, "SELECT subscription_id FROM deliveries WHERE event_type = 'subscription.gap'");
    expect(gaps).toEqual([{ subscription_id: mine.id }]);
    expect(theirs.id).not.toBe(mine.id);
    // The gap is not in the shared log either: GET /v1/events shows nothing to anybody.
    for (const auth of [s.auth, s.as(other.token)]) {
      const page = (await (await s.call('GET', '/v1/events?after=0', undefined, auth)).json()) as { events: { type: string }[] };
      expect(page.events.filter((e) => e.type === 'subscription.gap')).toEqual([]);
    }
  });
});

describe('long polls', () => {
  it('give back the seconds they did not wait when events come early', async () => {
    const s = await setup();
    const first = (await (await s.call('GET', '/v1/events', undefined, s.auth)).json()) as { next_cursor: string };
    let cursor = first.next_cursor;
    for (let i = 0; i < 2; i++) {
      setTimeout(() => void insertEvent(s), 100);
      const body = (await (await s.call('GET', `/v1/events?after=${cursor}&wait=25`, undefined, s.auth)).json()) as { events: unknown[]; next_cursor: string };
      expect(body.events).toHaveLength(1);
      cursor = body.next_cursor;
    }
    const used = (await one<{ count: number }>(s, "SELECT count FROM rate_counters WHERE key LIKE 'read:%:m'")).count;
    // The first call, and about three reads for each call that waited about three seconds (it was 51 before).
    expect(used).toBeLessThan(15);
    expect(used).toBeGreaterThanOrEqual(3);
  }, 30_000);

  it('never refund below zero or into another window', async () => {
    const s = await setup();
    const limit = { key: 'read:test:m', limit: 600, windowSeconds: 60 };
    await s.db
      .prepare('INSERT INTO rate_counters (key, window_start, count) VALUES (?, ?, 5)')
      .bind(limit.key, Math.floor(s.relay.now().getTime() / 60_000) * 60)
      .run();
    await refund(s.relay, limit, 50, s.relay.now());
    expect(await one(s, 'SELECT count FROM rate_counters WHERE key = ?', limit.key)).toEqual({ count: 0 });
    await refund(s.relay, limit, 50, new Date(s.relay.now().getTime() - 120_000));
    expect(await all(s, 'SELECT count FROM rate_counters WHERE key = ?', limit.key)).toEqual([{ count: 0 }]);
  });
});

describe('query plans', () => {
  const plan = (s: Setup, sql: string, ...args: unknown[]) =>
    (s.db as SqliteD1).raw
      .prepare(`EXPLAIN QUERY PLAN ${sql}`)
      .all(...(args as never[]))
      .map((r) => String((r as { detail: string }).detail))
      .join(' | ');

  it('list a forum’s open threads through the partial index', async () => {
    const s = await setup();
    const p = plan(s, 'SELECT t.id FROM threads t WHERE t.parent_id = ? AND t.deleted_at IS NULL AND t.archived = 0 ORDER BY t.id DESC LIMIT 50', LOUNGE);
    expect(p).toContain('threads_open');
  });

  it('find a removed message’s deliveries from its events, not from every open delivery', async () => {
    const s = await setup();
    const p = plan(
      s,
      "SELECT d.id FROM events e JOIN deliveries d INDEXED BY deliveries_event ON d.event_id = e.id WHERE e.message_id IN (?, ?) AND e.type IN ('message.created', 'message.updated') AND d.status IN ('pending', 'retrying')",
      '1',
      '2',
    );
    expect(p).toContain('events_message');
    expect(p).not.toContain('deliveries_due');
  });

  it('read the oldest cursor from the observed-at index', async () => {
    const s = await setup();
    const old = await insertEvent(s);
    s.advance(40 * 86_400_000);
    await insertEvent(s);
    const sql: string[] = [];
    const real = s.relay.db;
    s.relay.db = { batch: (x) => real.batch(x), prepare: (text) => (sql.push(text), real.prepare(text)) };
    const res = await s.call('GET', '/v1/events?after=0', undefined, s.auth);
    s.relay.db = real;
    expect(res.status).toBe(410);
    expect(((await res.json()) as { oldest_cursor: string }).oldest_cursor).toBe(String(old.seq));
    expect(sql.some((q) => q.includes('MIN(seq)'))).toBe(false);
    expect(plan(s, 'SELECT seq FROM events WHERE observed_at < ? ORDER BY observed_at DESC LIMIT 1', 'x')).toContain('events_observed');
  });
});
