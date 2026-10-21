import { beforeEach, describe, expect, it } from 'vitest';
import { HOOK_HOST, one, publish, recorder, setup, subscribe, type Created } from './deliveries.testkit';
import { attemptDelivery } from './services/deliveries';
import { ADMIN_DISCORD, seedAgent, seedOwner } from './testing';

interface Page<T> {
  next_before: string | null;
  deliveries?: T[];
  subscriptions?: T[];
}
type Row = Record<string, unknown> & { id: string; attempt_log?: { n: number; status_code: number | null }[] };

// Two owners, one agent each (plus one with no owner), an admin, and a mix of delivery outcomes.
async function world() {
  const s = await setup();
  const alice = await seedOwner(s.relay, '200000000000000001', 'alice');
  const bob = await seedOwner(s.relay, '200000000000000002', 'bob');
  const admin = await seedOwner(s.relay, ADMIN_DISCORD, 'admin');
  const aAgent = await seedAgent(s.relay, { name: 'AliceBot', ownerId: alice.id });
  const bAgent = await seedAgent(s.relay, { name: 'BobBot', ownerId: bob.id });
  const stray = await seedAgent(s.relay, { name: 'Stray' });
  const subA = await subscribe(s, {}, s.as(aAgent.key));
  const subB = await subscribe(s, {}, s.as(bAgent.key));
  const subS = await subscribe(s, {}, s.as(stray.key));

  let status = 200;
  const rec = recorder(() => new Response(null, { status }));
  s.receivers[HOOK_HOST] = rec.handler;
  const ids: string[] = [];
  for (let i = 0; i < 3; i++) {
    s.advance(1000);
    ids.push(...(await publish(s)).ids);
  }
  const mine = async (sub: Created) =>
    (await s.db.prepare('SELECT id FROM deliveries WHERE subscription_id = ? ORDER BY id').bind(sub.id).all<{ id: string }>()).results.map((r) => r.id);
  const [a1, a2, a3] = await mine(subA);
  const [b1] = await mine(subB);
  status = 200;
  await attemptDelivery(s.relay, a1!);
  status = 503;
  await attemptDelivery(s.relay, a2!);
  status = 404;
  await attemptDelivery(s.relay, a3!);
  await attemptDelivery(s.relay, b1!);
  return { s, alice, bob, admin, aAgent, bAgent, stray, subA, subB, subS, a: [a1!, a2!, a3!], b1: b1!, ids };
}

const as = (ownerId: string) => ({ 'x-logitland-owner': ownerId });
const json = async <T>(res: Response) => (await res.json()) as T;

describe('owner listings', () => {
  let w: Awaited<ReturnType<typeof world>>;
  beforeEach(async () => {
    w = await world();
  });

  it('lists the subscriptions of the owner’s agents with the agent’s name, and nobody else’s', async () => {
    const res = await w.s.internal('GET', `/internal/owners/${w.alice.id}/subscriptions`, undefined, as(w.alice.id));
    expect(res.status).toBe(200);
    const body = await json<{ subscriptions: Row[] }>(res);
    expect(body.subscriptions).toMatchObject([{ id: w.subA.id, agent_id: w.aAgent.id, agent_name: 'AliceBot', url_host: HOOK_HOST, status: 'active' }]);
    expect(JSON.stringify(body)).not.toContain('secret');
    expect(JSON.stringify(body)).not.toContain('ciphertext');

    const bobs = await json<{ subscriptions: Row[] }>(await w.s.internal('GET', `/internal/owners/${w.bob.id}/subscriptions`, undefined, as(w.bob.id)));
    expect(bobs.subscriptions.map((x) => x.id)).toEqual([w.subB.id]);
  });

  it('shows disabled subscriptions but not ones the agent deleted', async () => {
    await w.s.db
      .prepare("UPDATE subscriptions SET status = 'disabled', paused_reason = 'The destination answered 410 Gone' WHERE id = ?")
      .bind(w.subA.id)
      .run();
    const listed = await json<{ subscriptions: Row[] }>(await w.s.internal('GET', `/internal/owners/${w.alice.id}/subscriptions`, undefined, as(w.alice.id)));
    expect(listed.subscriptions).toMatchObject([{ id: w.subA.id, status: 'disabled', paused_reason: 'The destination answered 410 Gone' }]);
    await w.s.call('DELETE', `/v1/subscriptions/${w.subB.id}`, undefined, w.s.as(w.bAgent.key));
    const bobs = await json<{ subscriptions: Row[] }>(await w.s.internal('GET', `/internal/owners/${w.bob.id}/subscriptions`, undefined, as(w.bob.id)));
    expect(bobs.subscriptions).toEqual([]);
  });

  it('lists deliveries to the owner’s agents with attempts, newest first, and filters and pages them', async () => {
    const res = await w.s.internal('GET', `/internal/owners/${w.alice.id}/deliveries`, undefined, as(w.alice.id));
    expect(res.status).toBe(200);
    const page = await json<Page<Row>>(res);
    expect(page.deliveries!.map((d) => d.id)).toEqual([...w.a].sort().reverse());
    expect(page.next_before).toBeNull();
    const byId = Object.fromEntries(page.deliveries!.map((d) => [d.id, d]));
    expect(byId[w.a[0]!]).toMatchObject({ status: 'delivered', attempts: 1, url_host: HOOK_HOST, agent_id: w.aAgent.id, agent_name: 'AliceBot' });
    expect(byId[w.a[0]!]!.attempt_log).toMatchObject([{ n: 1, status_code: 200 }]);
    expect(byId[w.a[1]!]).toMatchObject({ status: 'retrying', last_status_code: 503 });
    expect(byId[w.a[2]!]).toMatchObject({ status: 'failed', last_status_code: 404 });
    expect(page.deliveries!.some((d) => d.agent_id === w.bAgent.id)).toBe(false);

    const failed = await json<Page<Row>>(await w.s.internal('GET', `/internal/owners/${w.alice.id}/deliveries?status=failed`, undefined, as(w.alice.id)));
    expect(failed.deliveries!.map((d) => d.id)).toEqual([w.a[2]]);

    const first = await json<Page<Row>>(await w.s.internal('GET', `/internal/owners/${w.alice.id}/deliveries?limit=2`, undefined, as(w.alice.id)));
    expect(first.deliveries).toHaveLength(2);
    expect(first.next_before).toBe(first.deliveries![1]!.id);
    const rest = await json<Page<Row>>(
      await w.s.internal('GET', `/internal/owners/${w.alice.id}/deliveries?limit=2&before=${first.next_before}`, undefined, as(w.alice.id)),
    );
    expect([...first.deliveries!, ...rest.deliveries!].map((d) => d.id)).toEqual([...w.a].sort().reverse());
    expect(rest.next_before).toBeNull();
  });

  it('rejects bad queries', async () => {
    const get = (q: string) => w.s.internal('GET', `/internal/owners/${w.alice.id}/deliveries?${q}`, undefined, as(w.alice.id));
    expect((await get('status=nope')).status).toBe(400);
    expect((await get('before=nope')).status).toBe(400);
    expect((await get('limit=ten')).status).toBe(400);
    expect((await get('limit=1000')).status).toBe(200);
  });

  it('is bound to the signed-in owner', async () => {
    for (const path of ['subscriptions', 'deliveries']) {
      expect((await w.s.internal('GET', `/internal/owners/${w.alice.id}/${path}`, undefined, as(w.bob.id))).status, path).toBe(403);
      expect((await w.s.internal('GET', `/internal/owners/${w.alice.id}/${path}`)).status, path).toBe(403);
      expect((await w.s.call('GET', `/internal/owners/${w.alice.id}/${path}`)).status, path).toBe(404); // not served by the public app
    }
  });
});

describe('admin listings and replay', () => {
  let w: Awaited<ReturnType<typeof world>>;
  const get = (path: string, who = w.admin.id) => w.s.internal('GET', path, undefined, as(who));
  beforeEach(async () => {
    w = await world();
  });

  it('is for admins only', async () => {
    for (const path of ['/internal/admin/deliveries', '/internal/admin/subscriptions']) {
      expect((await get(path, w.alice.id)).status, path).toBe(403);
      expect((await w.s.internal('GET', path)).status, path).toBe(401);
    }
    expect((await w.s.internal('POST', `/internal/admin/deliveries/${w.a[0]}/replay`, undefined, as(w.alice.id))).status).toBe(403);
  });

  it('lists deliveries from every agent with host, agent and attempts, filtered and paged', async () => {
    const page = await json<Page<Row>>(await get('/internal/admin/deliveries'));
    expect(page.deliveries).toHaveLength(9);
    const mine = page.deliveries!.find((d) => d.id === w.a[1])!;
    expect(mine).toMatchObject({ url_host: HOOK_HOST, agent_id: w.aAgent.id, agent_name: 'AliceBot', status: 'retrying' });
    expect(mine.attempt_log).toMatchObject([{ n: 1, status_code: 503 }]);
    expect(page.deliveries!.map((d) => d.agent_name)).toEqual(expect.arrayContaining(['AliceBot', 'BobBot', 'Stray']));

    const pending = await json<Page<Row>>(await get('/internal/admin/deliveries?status=pending'));
    expect(pending.deliveries!.every((d) => d.status === 'pending')).toBe(true);
    expect(pending.deliveries).toHaveLength(9 - 4);

    const seen: string[] = [];
    let before = '';
    for (let i = 0; i < 5; i++) {
      const next = await json<Page<Row>>(await get(`/internal/admin/deliveries?limit=4${before}`));
      seen.push(...next.deliveries!.map((d) => d.id));
      if (!next.next_before) break;
      before = `&before=${next.next_before}`;
    }
    expect(seen).toEqual([...page.deliveries!.map((d) => d.id)]);
    expect(new Set(seen).size).toBe(9);
  });

  it('lists subscription health: status, failure streak, last delivered and pending count', async () => {
    const page = await json<{ subscriptions: Row[]; next_before: string | null }>(await get('/internal/admin/subscriptions'));
    expect(page.subscriptions).toHaveLength(3);
    const a = page.subscriptions.find((x) => x.id === w.subA.id)!;
    expect(a).toMatchObject({
      agent_name: 'AliceBot',
      status: 'active',
      failure_streak: 1,
      pending_count: 1,
      last_delivered_at: w.s.relay.now().toISOString(),
    });
    const stray = page.subscriptions.find((x) => x.id === w.subS.id)!;
    expect(stray).toMatchObject({ failure_streak: 0, pending_count: 3, last_delivered_at: null });
    expect(JSON.stringify(page)).not.toContain('ciphertext');

    await w.s.db.prepare("UPDATE subscriptions SET status = 'paused' WHERE id = ?").bind(w.subB.id).run();
    const paused = await json<{ subscriptions: Row[] }>(await get('/internal/admin/subscriptions?status=paused'));
    expect(paused.subscriptions.map((x) => x.id)).toEqual([w.subB.id]);

    const first = await json<{ subscriptions: Row[]; next_before: string | null }>(await get('/internal/admin/subscriptions?limit=2'));
    expect(first.subscriptions).toHaveLength(2);
    const rest = await json<{ subscriptions: Row[]; next_before: string | null }>(
      await get(`/internal/admin/subscriptions?limit=2&before=${first.next_before}`),
    );
    expect([...first.subscriptions, ...rest.subscriptions].map((x) => x.id)).toEqual(page.subscriptions.map((x) => x.id));
    expect((await get('/internal/admin/subscriptions?status=nope')).status).toBe(400);
  });

  it('replays a delivery, audits it, and refuses unknown or in-flight ones', async () => {
    expect((await w.s.internal('POST', '/internal/admin/deliveries/del_0000000000/replay', undefined, as(w.admin.id))).status).toBe(404);
    // Waiting for its next retry: refused, with the reason.
    const waiting = await w.s.internal('POST', `/internal/admin/deliveries/${w.a[1]}/replay`, undefined, as(w.admin.id));
    expect(waiting.status).toBe(409);
    expect((await json<{ detail: string }>(waiting)).detail).toContain('next retry');

    w.s.receivers[HOOK_HOST] = () => new Response(null, { status: 200 });
    const res = await w.s.internal('POST', `/internal/admin/deliveries/${w.a[2]}/replay`, undefined, as(w.admin.id));
    expect(res.status).toBe(200);
    const body = await json<{ outcome: string; reason: string | null; delivery: Row & { status: string; attempts: number } }>(res);
    expect(body).toMatchObject({ outcome: 'delivered', reason: null, delivery: { id: w.a[2], status: 'delivered', attempts: 2, agent_name: 'AliceBot' } });
    expect(body.delivery.attempt_log).toMatchObject([
      { n: 1, status_code: 404 },
      { n: 2, status_code: 200 },
    ]);
    expect(await one(w.s, "SELECT actor_type, actor_id, target_id FROM audit_log WHERE action = 'delivery.replayed'")).toEqual({
      actor_type: 'admin',
      actor_id: w.admin.id,
      target_id: w.a[2],
    });
  });

  it('reports a replay that is dropped again, with the reason', async () => {
    await w.s.db.prepare("UPDATE subscriptions SET status = 'paused' WHERE id = ?").bind(w.subA.id).run();
    const res = await w.s.internal('POST', `/internal/admin/deliveries/${w.a[2]}/replay`, undefined, as(w.admin.id));
    expect(res.status).toBe(200);
    expect(await json<{ outcome: string; reason: string }>(res)).toMatchObject({ outcome: 'dropped', reason: 'The subscription is no longer active' });
  });
});
