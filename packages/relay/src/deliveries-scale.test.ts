import { describe, expect, it } from 'vitest';
import type { Setup } from './deliveries.testkit';
import { say } from './deliveries.testkit';
import { attemptDelivery, drainDue, handleDeliveryBatch, listDeliveries, pushDue, replayDelivery } from './services/deliveries';
import { updateSettings } from './services/settings';
import { dropOpenStmt } from './services/webhook';
import { all, delivery, hooked, next, one, receive, reply, webhook } from './webhook.testkit';

describe('the audit entry of a pause or a disable', () => {
  it('is written once when concurrent failures cross the threshold', async () => {
    const { s, id } = await hooked(reply(400));
    await s.db.prepare('UPDATE agent_webhooks SET failure_streak = 49 WHERE agent_id = ?').bind(s.agent.id).run();
    const ids = [id, await next(s), await next(s)];
    await Promise.all(ids.map((d) => attemptDelivery(s.relay, d)));
    expect((await webhook(s)).status).toBe('paused');
    expect(await all(s, "SELECT target_id FROM audit_log WHERE action = 'webhook.paused'")).toEqual([{ target_id: s.agent.id }]);
    expect(s.log.lines.filter((l) => l.event === 'webhook.paused')).toHaveLength(1);
  });

  it('is not written for a failure after the webhook was paused another way', async () => {
    const { s, id } = await hooked();
    await s.db.prepare('UPDATE agent_webhooks SET failure_streak = 49 WHERE agent_id = ?').bind(s.agent.id).run();
    receive(s, async () => {
      // Paused by something else while this attempt is in flight.
      await s.db.prepare("UPDATE agent_webhooks SET status = 'paused' WHERE agent_id = ?").bind(s.agent.id).run();
      return new Response(null, { status: 400 });
    });
    await attemptDelivery(s.relay, id);
    expect(await all(s, "SELECT 1 FROM audit_log WHERE action = 'webhook.paused'")).toEqual([]);
  });

  it('is written once when several deliveries get 410 at once', async () => {
    const { s, id } = await hooked(reply(410));
    const ids = [id, await next(s)];
    await Promise.all(ids.map((d) => attemptDelivery(s.relay, d)));
    expect((await webhook(s)).status).toBe('disabled');
    expect(await all(s, "SELECT target_id FROM audit_log WHERE action = 'webhook.disabled'")).toEqual([{ target_id: s.agent.id }]);
  });
});

describe('when an admin switches deliveries off', () => {
  const switchOff = (s: Setup, paused: boolean) => updateSettings(s.relay, 'own_admin', { deliveries_paused: paused });

  it('takes, enqueues and sends nothing, then catches up once they are back on', async () => {
    const { s, q, rec, id } = await hooked();
    await switchOff(s, true);
    const before = { deliveries: [...q.deliveries], pushes: q.pushes.length };

    await say(s, 'while off');
    expect(await pushDue(s.relay, s.agent.id)).toBe(0);
    expect(await attemptDelivery(s.relay, id)).toMatchObject({ outcome: 'skipped' });
    expect(await delivery(s, id)).toMatchObject({ status: 'pending', attempts: 0 });
    expect(await drainDue(s.relay)).toBe(0);
    expect(await replayDelivery(s.relay, id, 'own_admin')).toMatchObject({ outcome: 'skipped' });
    expect(q.deliveries).toEqual(before.deliveries);
    expect(q.pushes).toHaveLength(before.pushes);
    expect(rec.requests).toHaveLength(0);

    await switchOff(s, false);
    s.advance(11 * 60_000);
    // The agent whose subscription is due is pushed, and the waiting delivery handed over again.
    expect(await drainDue(s.relay)).toBe(2);
    expect(q.pushes.at(-1)).toEqual({ agent: s.agent.id });
    expect(q.deliveries.at(-1)).toBe(id);
    expect(await attemptDelivery(s.relay, id)).toEqual({ outcome: 'delivered' });
  });

  it('acknowledges queued messages and makes their rows due for the cron scan again', async () => {
    const { s, id } = await hooked();
    await switchOff(s, true);
    const calls = { ack: 0, retry: 0 };
    const results = await handleDeliveryBatch(s.relay, [{ body: { delivery_id: id }, ack: () => void calls.ack++, retry: () => void calls.retry++ }]);
    expect(results).toMatchObject([{ outcome: 'skipped' }]);
    expect(calls).toEqual({ ack: 1, retry: 0 });
    expect((await delivery(s, id)).enqueued_at).toBeNull();
  });
});

describe('queries that must use an index', () => {
  const plan = (s: Setup, sql: string, ...args: unknown[]) =>
    (s.db.raw.prepare(`EXPLAIN QUERY PLAN ${sql}`).all(...(args as never[])) as { detail: string }[]).map((r) => r.detail).join('\n');

  it('lists one agent’s deliveries newest first without sorting them', async () => {
    const { s } = await hooked();
    const sql = 'SELECT d.id FROM deliveries d JOIN agents a ON a.id = d.agent_id WHERE d.agent_id = ? AND d.id < ? ORDER BY d.id DESC LIMIT 50';
    const p = plan(s, sql, s.agent.id, 'del_z');
    expect(p).toContain('deliveries_agent');
    expect(p).not.toContain('TEMP B-TREE');
    // And the listing still pages correctly.
    for (let i = 0; i < 2; i++) await next(s);
    const page = await listDeliveries(s.relay, { agentId: s.agent.id, limit: 2 });
    expect(page.deliveries).toHaveLength(2);
    expect(page.next_before).toBe(page.deliveries[1]!.id);
  });

  it('drops an agent’s waiting deliveries through the partial index', async () => {
    const { s, id } = await hooked();
    const stmt = dropOpenStmt(s.relay, s.agent.id, 'gone');
    expect(plan(s, (stmt as unknown as { sql: string }).sql, 'gone', s.agent.id)).toContain('deliveries_open');
    await stmt.run();
    expect((await delivery(s, id)).status).toBe('dropped');
  });

  it('finds the subscriptions that are due through their index', async () => {
    const { s } = await hooked();
    const p = plan(s, 'SELECT DISTINCT s.agent_id FROM subscriptions s WHERE s.next_due_ms IS NOT NULL AND s.next_due_ms <= ? LIMIT 100', 0);
    expect(p).toContain('subscriptions_due');
    expect(await one(s, 'SELECT COUNT(*) AS n FROM subscriptions WHERE next_due_ms IS NOT NULL')).toEqual({ n: 0 });
  });
});
