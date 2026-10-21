import { DeliveryId, newId } from '@logitland/contracts';
import { describe, expect, it } from 'vitest';
import { all, HOOK_HOST, insertEvent, one, publish, recorder, setup, subscribe, type Setup } from './deliveries.testkit';
import { attemptDelivery, audienceOf, drainDue, fanOut, handleDeliveryBatch, listDeliveries, newFanOutBudget, replayDelivery } from './services/deliveries';
import { fanOutAll, refanJob } from './services/events';
import { updateSettings } from './services/settings';
import { dropPendingStmt } from './services/subscriptions';
import { ADMIN_DISCORD, BENCH, LOUNGE, seedOwner } from './testing';

/** Subscriptions inserted directly (the cap would stop us creating this many), for fan-out volume. */
async function seedSubscriptions(s: Setup, agentId: string, n: number, opts: { channel?: string; events?: string[]; at?: string } = {}) {
  const at = opts.at ?? s.relay.now().toISOString();
  const channel = opts.channel ?? LOUNGE;
  const ids = Array.from({ length: n }, () => newId('subscription'));
  for (let i = 0; i < ids.length; i += 200) {
    await s.relay.db.batch(
      ids
        .slice(i, i + 200)
        .flatMap((id) => [
          s.relay.db
            .prepare(
              "INSERT INTO subscriptions (id, agent_id, url_ciphertext, url_host, events, channel_ids, secret_ciphertext, status, created_at) VALUES (?, ?, 'x', ?, ?, ?, 'x', 'active', ?)",
            )
            .bind(id, agentId, HOOK_HOST, JSON.stringify(opts.events ?? ['message.created']), JSON.stringify([channel]), at),
          s.relay.db.prepare('INSERT INTO subscription_channels (subscription_id, channel_id) VALUES (?, ?)').bind(id, channel),
        ]),
    );
  }
  return ids;
}

/** Counts the statements the relay prepares while `work` runs. */
async function statementsDuring(s: Setup, work: () => Promise<unknown>) {
  const sql: string[] = [];
  const real = s.relay.db;
  s.relay.db = {
    batch: (statements) => {
      sql.push(...statements.map(() => 'batch statement'));
      return real.batch(statements);
    },
    prepare: (text) => {
      sql.push(text);
      return real.prepare(text);
    },
  };
  try {
    await work();
  } finally {
    s.relay.db = real;
  }
  return sql;
}

const mockQueue = () => {
  const sent: string[] = [];
  return {
    sent,
    queue: {
      send: async (b: { delivery_id: string }) => void sent.push(b.delivery_id),
      sendBatch: async (m: { body: { delivery_id: string } }[]) => void sent.push(...m.map((x) => x.body.delivery_id)),
    },
  };
};

describe('fan-out in rounds', () => {
  it('creates a round of deliveries with one INSERT … SELECT, 500 at a time, each subscription once', async () => {
    const s = await setup();
    await seedSubscriptions(s, s.agent.id, 1_230);
    const event = await insertEvent(s);
    const sql = await statementsDuring(s, async () => {
      expect(await fanOut(s.relay, event)).toHaveLength(1_230);
    });
    // Three rounds (500, 500, 230); no per-subscription statements.
    expect(sql.filter((q) => q.includes('INSERT OR IGNORE INTO deliveries'))).toHaveLength(3);
    expect(sql.length).toBeLessThan(5);
    expect(await one(s, 'SELECT COUNT(DISTINCT subscription_id) AS n, COUNT(*) AS m FROM deliveries')).toEqual({ n: 1_230, m: 1_230 });
    // Again: nothing new.
    expect(await fanOut(s.relay, event)).toEqual([]);
    expect(await one(s, 'SELECT COUNT(*) AS n FROM deliveries')).toEqual({ n: 1_230 });
  });

  it('makes delivery IDs that are valid, unique and sort by time', async () => {
    const s = await setup();
    await seedSubscriptions(s, s.agent.id, 300);
    const first = await fanOut(s.relay, await insertEvent(s));
    s.advance(5_000);
    const second = await fanOut(s.relay, await insertEvent(s));
    for (const id of [...first, ...second]) expect(DeliveryId.safeParse(id).success, id).toBe(true);
    expect(new Set([...first, ...second]).size).toBe(600);
    expect(first.every((a) => second.every((b) => a < b))).toBe(true);
  });

  it('stops at its budget, leaves the event for the refan job, and finishes the rest without duplicates', async () => {
    const s = await setup();
    await seedSubscriptions(s, s.agent.id, 1_200);
    const event = await insertEvent(s);
    const budget = newFanOutBudget();
    budget.queries = 2;
    expect(await fanOut(s.relay, event, { budget })).toHaveLength(1_000);
    expect(budget.stopped).toBe(true);
    expect(s.log.lines.some((l) => l.event === 'deliveries.fan_out_partial')).toBe(true);

    expect(await fanOut(s.relay, event)).toHaveLength(200);
    expect(await one(s, 'SELECT COUNT(*) AS n, COUNT(DISTINCT subscription_id) AS m FROM deliveries')).toEqual({ n: 1_200, m: 1_200 });
  });

  it('leaves an event it could not finish unfanned, and the refan job completes it', async () => {
    const s = await setup();
    await seedSubscriptions(s, s.agent.id, 700);
    const event = await insertEvent(s);
    const budget = newFanOutBudget();
    budget.queries = 2; // the channel lookup and one round
    expect(await fanOutAll(s.relay, [event], budget)).toBe(500);
    expect((await one<{ fanned_out_at: string | null }>(s, 'SELECT fanned_out_at FROM events WHERE id = ?', event.id)).fanned_out_at).toBeNull();

    s.advance(61_000);
    expect(await refanJob(s.relay)).toBe(1);
    expect((await one<{ fanned_out_at: string | null }>(s, 'SELECT fanned_out_at FROM events WHERE id = ?', event.id)).fanned_out_at).not.toBeNull();
    expect(await one(s, 'SELECT COUNT(*) AS n, COUNT(DISTINCT subscription_id) AS m FROM deliveries')).toEqual({ n: 700, m: 700 });
  });

  it('spends one query on a batch of events nobody subscribes to, and marks them fanned out', async () => {
    const s = await setup();
    await subscribe(s, { channel_ids: [BENCH] });
    const events = [await insertEvent(s, { channel: LOUNGE }), await insertEvent(s, { channel: LOUNGE })];
    const sql = await statementsDuring(s, async () => void (await fanOutAll(s.relay, events)));
    expect(sql.filter((q) => q.includes('INSERT OR IGNORE INTO deliveries'))).toHaveLength(0);
    // The lookup of watched channels, and marking the events.
    expect(sql).toHaveLength(2);
    expect(await all(s, 'SELECT id FROM events WHERE fanned_out_at IS NULL')).toEqual([]);
  });

  it('enqueues the deliveries of several events together', async () => {
    const s = await setup();
    const q = mockQueue();
    s.relay.queue = q.queue;
    await subscribe(s);
    const events = [await insertEvent(s), await insertEvent(s), await insertEvent(s)];
    const sql = await statementsDuring(s, async () => void (await fanOutAll(s.relay, events)));
    expect(q.sent).toHaveLength(3);
    // One UPDATE stamps all three, not one each.
    expect(sql.filter((q2) => q2.startsWith('UPDATE deliveries SET enqueued_at'))).toHaveLength(1);
  });
});

describe('removals follow the message text', () => {
  it('sends message.deleted and message.bulk_deleted to every subscription that gets message.created or message.updated', () => {
    expect(audienceOf('message.deleted').sort()).toEqual(['message.created', 'message.deleted', 'message.updated']);
    expect(audienceOf('message.bulk_deleted').sort()).toEqual(['message.bulk_deleted', 'message.created', 'message.updated']);
    expect(audienceOf('message.created')).toEqual(['message.created']);
  });

  it('applies to subscriptions stored without them, and not to those that never get message text', async () => {
    const s = await setup();
    const [textOnly] = await seedSubscriptions(s, s.agent.id, 1, { events: ['message.updated'] });
    const [removalsOnly] = await seedSubscriptions(s, s.agent.id, 1, { events: ['message.bulk_deleted'] });
    const [gapOnly] = await seedSubscriptions(s, s.agent.id, 1, { events: ['subscription.gap'] });
    const who = async (ids: string[]) =>
      (await all<{ subscription_id: string }>(s, 'SELECT subscription_id FROM deliveries WHERE id IN (SELECT value FROM json_each(?))', JSON.stringify(ids)))
        .map((r) => r.subscription_id)
        .sort();

    expect(await who((await publish(s, { type: 'message.deleted', data: { message_id: '310000000000000001', removed_by: 'author' } })).ids)).toEqual([
      textOnly,
    ]);
    expect(await who((await publish(s, { type: 'message.bulk_deleted', data: { message_ids: ['310000000000000002'] } })).ids)).toEqual(
      [removalsOnly, textOnly].sort(),
    );
    expect(gapOnly).toBeDefined();
    expect(await who((await publish(s, { type: 'message.deleted', data: { message_id: '310000000000000003', removed_by: 'author' } })).ids)).toEqual([
      textOnly,
    ]);
  });
});

describe('the audit entry of a pause or a disable', () => {
  const failing = (status: number) => () => new Response(null, { status });

  it('is written once when concurrent failures cross the threshold', async () => {
    const s = await setup();
    const sub = await subscribe(s);
    s.receivers[HOOK_HOST] = recorder(failing(400)).handler;
    await s.db.prepare('UPDATE subscriptions SET failure_streak = 49 WHERE id = ?').bind(sub.id).run();
    const ids = [(await publish(s)).ids[0]!, (await publish(s)).ids[0]!, (await publish(s)).ids[0]!];
    await Promise.all(ids.map((id) => attemptDelivery(s.relay, id)));
    expect(await one(s, 'SELECT status, failure_streak FROM subscriptions WHERE id = ?', sub.id)).toEqual({ status: 'paused', failure_streak: 50 });
    expect(await all(s, "SELECT target_id FROM audit_log WHERE action = 'subscription.paused'")).toEqual([{ target_id: sub.id }]);
    expect(s.log.lines.filter((l) => l.event === 'subscription.paused')).toHaveLength(1);
  });

  it('is not written for a failure after the subscription was paused another way', async () => {
    const s = await setup();
    const sub = await subscribe(s);
    s.receivers[HOOK_HOST] = recorder(failing(400)).handler;
    await s.db.prepare('UPDATE subscriptions SET failure_streak = 49 WHERE id = ?').bind(sub.id).run();
    const { ids } = await publish(s);
    await s.db.prepare("UPDATE subscriptions SET status = 'paused' WHERE id = ?").bind(sub.id).run();
    await attemptDelivery(s.relay, ids[0]!);
    expect(await all(s, "SELECT 1 FROM audit_log WHERE action = 'subscription.paused'")).toEqual([]);
  });

  it('is written once when several deliveries get 410 at once', async () => {
    const s = await setup();
    const sub = await subscribe(s);
    s.receivers[HOOK_HOST] = recorder(failing(410)).handler;
    const ids = [(await publish(s)).ids[0]!, (await publish(s)).ids[0]!];
    await Promise.all(ids.map((id) => attemptDelivery(s.relay, id)));
    expect((await one<{ status: string }>(s, 'SELECT status FROM subscriptions WHERE id = ?', sub.id)).status).toBe('disabled');
    expect(await all(s, "SELECT target_id FROM audit_log WHERE action = 'subscription.disabled'")).toEqual([{ target_id: sub.id }]);
  });
});

describe('when deliveries are paused', () => {
  const pause = async (s: Setup, paused: boolean) => {
    const admin = await seedOwner(s.relay, ADMIN_DISCORD, 'admin').catch(() => ({ id: 'own_admin' }));
    await updateSettings(s.relay, admin.id, { deliveries_paused: paused });
  };

  it('still creates deliveries but enqueues and sends none, then sends them once it is off', async () => {
    const s = await setup();
    const q = mockQueue();
    s.relay.queue = q.queue;
    const sub = await subscribe(s);
    const rec = recorder();
    s.receivers[HOOK_HOST] = rec.handler;
    await pause(s, true);

    const { ids } = await publish(s);
    expect(ids).toHaveLength(1);
    expect(q.sent).toEqual([]);
    expect((await one<{ enqueued_at: string | null }>(s, 'SELECT enqueued_at FROM deliveries WHERE id = ?', ids[0]!)).enqueued_at).toBeNull();
    expect(await attemptDelivery(s.relay, ids[0]!)).toMatchObject({ outcome: 'skipped' });
    expect(await one(s, 'SELECT status, attempts FROM deliveries WHERE id = ?', ids[0]!)).toEqual({ status: 'pending', attempts: 0 });
    expect(await drainDue(s.relay)).toBe(0);
    expect(await replayDelivery(s.relay, ids[0]!, 'own_admin')).toMatchObject({ outcome: 'skipped' });
    expect(rec.requests).toHaveLength(0);
    expect((await one<{ n: number }>(s, "SELECT COUNT(*) AS n FROM subscriptions WHERE id = ? AND status = 'active'", sub.id)).n).toBe(1);

    await pause(s, false);
    expect(await drainDue(s.relay)).toBe(1);
    expect(q.sent).toEqual(ids);
    expect(await attemptDelivery(s.relay, ids[0]!)).toEqual({ outcome: 'delivered' });
  });

  it('acknowledges queued messages and makes their rows due for the cron scan again', async () => {
    const s = await setup();
    const { ids } = await (async () => {
      await subscribe(s);
      return publish(s);
    })();
    await s.db.prepare('UPDATE deliveries SET enqueued_at = ? WHERE id = ?').bind(s.relay.now().toISOString(), ids[0]!).run();
    await pause(s, true);
    const calls = { ack: 0, retry: 0 };
    const results = await handleDeliveryBatch(s.relay, [{ body: { delivery_id: ids[0]! }, ack: () => void calls.ack++, retry: () => void calls.retry++ }]);
    expect(results).toMatchObject([{ outcome: 'skipped' }]);
    expect(calls).toEqual({ ack: 1, retry: 0 });
    expect((await one<{ enqueued_at: string | null }>(s, 'SELECT enqueued_at FROM deliveries WHERE id = ?', ids[0]!)).enqueued_at).toBeNull();
  });
});

describe('drainDue with a queue', () => {
  it('clears a backlog of thousands in one run, 500 a round', async () => {
    const s = await setup();
    await seedSubscriptions(s, s.agent.id, 1_300);
    const event = await insertEvent(s);
    await fanOut(s.relay, event); // no queue yet: 1,300 deliveries with no enqueued_at
    const q = mockQueue();
    s.relay.queue = q.queue;
    expect(await drainDue(s.relay)).toBe(1_300);
    expect(new Set(q.sent).size).toBe(1_300);
    expect(await drainDue(s.relay)).toBe(0);
  });

  it('stops asking a queue that refuses', async () => {
    const s = await setup();
    await seedSubscriptions(s, s.agent.id, 1_300);
    await fanOut(s.relay, await insertEvent(s));
    let calls = 0;
    s.relay.queue = {
      send: async () => void calls++,
      sendBatch: async () => {
        calls++;
        throw new Error('Too Many Requests');
      },
    };
    await drainDue(s.relay);
    // One round of five failed batches, not twenty rounds of them.
    expect(calls).toBe(5);
  });
});

describe('queries that must use an index', () => {
  const plan = (s: Setup, sql: string, ...args: unknown[]) =>
    (s.db.raw.prepare(`EXPLAIN QUERY PLAN ${sql}`).all(...(args as never[])) as { detail: string }[]).map((r) => r.detail).join('\n');

  it('lists one subscription’s deliveries newest first without sorting them', async () => {
    const s = await setup();
    const sub = await subscribe(s);
    const sqlText = `SELECT d.id FROM deliveries d JOIN subscriptions s ON s.id = d.subscription_id JOIN agents a ON a.id = s.agent_id WHERE d.subscription_id = ? AND d.id < ? ORDER BY d.id DESC LIMIT 50`;
    const p = plan(s, sqlText, sub.id, 'del_z');
    expect(p).toContain('deliveries_subscription');
    expect(p).not.toContain('TEMP B-TREE');
    // And the function still pages correctly.
    for (let i = 0; i < 3; i++) await publish(s);
    const page = await listDeliveries(s.relay, { subscriptionId: sub.id, limit: 2 });
    expect(page.deliveries).toHaveLength(2);
    expect(page.next_before).toBe(page.deliveries[1]!.id);
  });

  it('drops a subscription’s waiting deliveries through the partial index', async () => {
    const s = await setup();
    const sub = await subscribe(s);
    const { ids } = await publish(s);
    const sql = (dropPendingStmt(s.relay, sub.id, 'gone') as unknown as { sql: string }).sql;
    expect(plan(s, sql, 'gone', sub.id)).toContain('deliveries_open');
    const paused = (dropPendingStmt(s.relay, sub.id, 'gone', 'paused') as unknown as { sql: string }).sql;
    expect(plan(s, paused, 'gone', sub.id, sub.id, 'paused')).toContain('deliveries_open');
    await dropPendingStmt(s.relay, sub.id, 'gone').run();
    expect((await one<{ status: string }>(s, 'SELECT status FROM deliveries WHERE id = ?', ids[0]!)).status).toBe('dropped');
  });

  it('keeps a pause from dropping anything unless the subscription is paused at that point', async () => {
    const s = await setup();
    const sub = await subscribe(s);
    const { ids } = await publish(s);
    expect((await dropPendingStmt(s.relay, sub.id, 'gone', 'paused').run()).meta.changes).toBe(0);
    await s.db.prepare("UPDATE subscriptions SET status = 'paused' WHERE id = ?").bind(sub.id).run();
    expect((await dropPendingStmt(s.relay, sub.id, 'gone', 'paused').run()).meta.changes).toBe(1);
    expect((await one<{ status: string }>(s, 'SELECT status FROM deliveries WHERE id = ?', ids[0]!)).status).toBe('dropped');
  });

  it('serves the fan-out round from the channel’s subscriptions, in order', async () => {
    const s = await setup();
    await seedSubscriptions(s, s.agent.id, 3);
    const p = plan(
      s,
      `SELECT sc.subscription_id FROM subscription_channels sc JOIN subscriptions s ON s.id = sc.subscription_id WHERE sc.channel_id = ? AND sc.subscription_id > ? ORDER BY sc.subscription_id LIMIT 500`,
      LOUNGE,
      '',
    );
    expect(p).toContain('subscription_channels');
    expect(p).not.toContain('TEMP B-TREE');
  });
});
