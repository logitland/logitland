import type { Subscription } from '@logitland/contracts';
import { beforeEach, describe, expect, it } from 'vitest';
import { HOOK, HOOK_HOST, echoChallenge, say, setup, subscribe } from './deliveries.testkit';
import { ADMIN_DISCORD, seedAgent, seedOwner } from './testing';

interface Page<T> {
  next_before: string | null;
  deliveries?: T[];
  subscriptions?: T[];
}
type Row = Record<string, unknown> & { id: string; attempt_log?: { n: number; status_code: number | null }[] };

/**
 * Two owners, one agent each (plus one with no owner), an admin, and three rounds of digests to each agent's webhook. Alice's
 * receiver answers 200, then 503, then 404; Bob's always 404; the stray's always 200.
 */
async function world() {
  const s = await setup();
  const alice = await seedOwner(s.relay, '200000000000000001', 'alice');
  const bob = await seedOwner(s.relay, '200000000000000002', 'bob');
  const admin = await seedOwner(s.relay, ADMIN_DISCORD, 'admin');
  const aAgent = await seedAgent(s.relay, { name: 'AliceBot', ownerId: alice.id });
  const bAgent = await seedAgent(s.relay, { name: 'BobBot', ownerId: bob.id });
  const stray = await seedAgent(s.relay, { name: 'Stray' });
  const answers: Record<string, number> = { '/logitland/AliceBot': 200, '/logitland/BobBot': 404, '/logitland/Stray': 200 };
  s.receivers[HOOK_HOST] = async (req) => {
    if (((await req.clone().json()) as { type: string }).type === 'delivery.challenge') return echoChallenge(req);
    return new Response(null, { status: answers[new URL(req.url).pathname] });
  };
  const subs: Subscription[] = [];
  for (const agent of [aAgent, bAgent, stray]) {
    subs.push(await subscribe(s, { frequency: 'live' }, s.as(agent.token)));
    expect((await s.call('PUT', '/v1/delivery', { url: `${HOOK}/${agent.name}` }, s.as(agent.token))).status).toBe(200);
  }
  for (const status of [200, 503, 404]) {
    answers['/logitland/AliceBot'] = status;
    s.advance(1000);
    await say(s, `round ${status}`);
  }
  const mine = async (agentId: string) =>
    (await s.db.prepare('SELECT id FROM deliveries WHERE agent_id = ? ORDER BY id').bind(agentId).all<{ id: string }>()).results.map((r) => r.id);
  const [subA, subB, subS] = subs as [Subscription, Subscription, Subscription];
  return { s, alice, bob, admin, aAgent, bAgent, stray, subA, subB, subS, a: await mine(aAgent.id) };
}

const as = (ownerId: string) => ({ 'x-logitland-owner': ownerId });
const json = async <T>(res: Response) => (await res.json()) as T;

describe('owner listings', () => {
  let w: Awaited<ReturnType<typeof world>>;
  beforeEach(async () => {
    w = await world();
  });

  it('lists the subscriptions of the owner’s agents with the agent’s name, and not ones the agent deleted', async () => {
    const res = await w.s.internal('GET', `/internal/owners/${w.alice.id}/subscriptions`, undefined, as(w.alice.id));
    expect(res.status).toBe(200);
    expect((await json<{ subscriptions: Row[] }>(res)).subscriptions).toEqual([
      { ...w.subA, cursor: expect.any(String), agent_id: w.aAgent.id, agent_name: 'AliceBot' },
    ]);
    await w.s.call('DELETE', `/v1/subscriptions/${w.subB.id}`, undefined, w.s.as(w.bAgent.token));
    const bobs = await json<{ subscriptions: Row[] }>(await w.s.internal('GET', `/internal/owners/${w.bob.id}/subscriptions`, undefined, as(w.bob.id)));
    expect(bobs.subscriptions).toEqual([]);
  });

  it('lets the owner change an agent’s subscription, audited as theirs, and no one else’s', async () => {
    const path = (sub: Subscription) => `/internal/owners/${w.alice.id}/subscriptions/${sub.id}`;
    const res = await w.s.internal('PATCH', path(w.subA), { frequency: '15m' }, as(w.alice.id));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ id: w.subA.id, frequency: '15m' });
    expect(await w.s.db.prepare("SELECT actor_type, actor_id FROM audit_log WHERE action = 'subscription.updated'").first()).toEqual({
      actor_type: 'owner',
      actor_id: w.alice.id,
    });
    expect((await w.s.internal('PATCH', path(w.subB), { frequency: '15m' }, as(w.alice.id))).status).toBe(404);
  });

  it('shows and sets an agent’s delivery and daily event cap', async () => {
    const path = `/internal/owners/${w.alice.id}/agents/${w.aAgent.id}/delivery`;
    const shown = await json<Record<string, unknown>>(await w.s.internal('GET', path, undefined, as(w.alice.id)));
    expect(shown).toMatchObject({ delivery: { kind: 'webhook', url_host: HOOK_HOST, status: 'active' }, daily_event_cap: null, delivered_today: 3 });
    const set = await w.s.internal('PATCH', path, { daily_event_cap: 500 }, as(w.alice.id));
    expect(set.status).toBe(200);
    expect(await set.json()).toMatchObject({ daily_event_cap: 500 });
    expect(await w.s.db.prepare("SELECT actor_id FROM audit_log WHERE action = 'agent.cap_set'").first()).toEqual({ actor_id: w.alice.id });
    expect((await w.s.internal('GET', `/internal/owners/${w.alice.id}/agents/${w.bAgent.id}/delivery`, undefined, as(w.alice.id))).status).toBe(404);
  });

  it('lists deliveries to the owner’s agents with attempts, newest first, and filters and pages them', async () => {
    const res = await w.s.internal('GET', `/internal/owners/${w.alice.id}/deliveries`, undefined, as(w.alice.id));
    expect(res.status).toBe(200);
    const page = await json<Page<Row>>(res);
    expect(page.deliveries!.map((d) => d.id)).toEqual([...w.a].reverse());
    expect(page.next_before).toBeNull();
    const byId = Object.fromEntries(page.deliveries!.map((d) => [d.id, d]));
    expect(byId[w.a[0]!]).toMatchObject({
      status: 'delivered',
      attempts: 1,
      event_count: 1,
      subscription_id: w.subA.id,
      url_host: HOOK_HOST,
      agent_id: w.aAgent.id,
      agent_name: 'AliceBot',
    });
    expect(byId[w.a[0]!]!.attempt_log).toMatchObject([{ n: 1, status_code: 200 }]);
    expect(byId[w.a[1]!]).toMatchObject({ status: 'retrying', last_status_code: 503 });
    expect(byId[w.a[2]!]).toMatchObject({ status: 'failed', last_status_code: 404 });

    const failed = await json<Page<Row>>(await w.s.internal('GET', `/internal/owners/${w.alice.id}/deliveries?status=failed`, undefined, as(w.alice.id)));
    expect(failed.deliveries!.map((d) => d.id)).toEqual([w.a[2]]);

    const first = await json<Page<Row>>(await w.s.internal('GET', `/internal/owners/${w.alice.id}/deliveries?limit=2`, undefined, as(w.alice.id)));
    expect(first.deliveries).toHaveLength(2);
    expect(first.next_before).toBe(first.deliveries![1]!.id);
    const rest = await json<Page<Row>>(
      await w.s.internal('GET', `/internal/owners/${w.alice.id}/deliveries?limit=2&before=${first.next_before}`, undefined, as(w.alice.id)),
    );
    expect([...first.deliveries!, ...rest.deliveries!].map((d) => d.id)).toEqual([...w.a].reverse());
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
    for (const path of ['subscriptions', 'deliveries', `agents/${w.aAgent.id}/delivery`]) {
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

    const failed = await json<Page<Row>>(await get('/internal/admin/deliveries?status=failed'));
    expect(failed.deliveries!.map((d) => d.agent_name).sort()).toEqual(['AliceBot', 'BobBot', 'BobBot', 'BobBot']);

    const seen: string[] = [];
    let before = '';
    for (let i = 0; i < 5; i++) {
      const next = await json<Page<Row>>(await get(`/internal/admin/deliveries?limit=4${before}`));
      seen.push(...next.deliveries!.map((d) => d.id));
      if (!next.next_before) break;
      before = `&before=${next.next_before}`;
    }
    expect(seen).toEqual(page.deliveries!.map((d) => d.id));
  });

  it('lists every subscription with its agent and when it last delivered, paged', async () => {
    const page = await json<{ subscriptions: Row[]; next_before: string | null }>(await get('/internal/admin/subscriptions'));
    expect(page.subscriptions.map((x) => x.id).sort()).toEqual([w.subA.id, w.subB.id, w.subS.id].sort());
    expect(page.subscriptions.find((x) => x.id === w.subA.id)).toMatchObject({ agent_name: 'AliceBot', last_delivered_at: w.s.now().toISOString() });

    const first = await json<{ subscriptions: Row[]; next_before: string | null }>(await get('/internal/admin/subscriptions?limit=2'));
    expect(first.subscriptions).toHaveLength(2);
    const rest = await json<{ subscriptions: Row[]; next_before: string | null }>(
      await get(`/internal/admin/subscriptions?limit=2&before=${first.next_before}`),
    );
    expect([...first.subscriptions, ...rest.subscriptions].map((x) => x.id)).toEqual(page.subscriptions.map((x) => x.id));
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
    expect(await w.s.db.prepare("SELECT actor_type, actor_id, target_id FROM audit_log WHERE action = 'delivery.replayed'").first()).toEqual({
      actor_type: 'admin',
      actor_id: w.admin.id,
      target_id: w.a[2],
    });
  });

  it('reports a replay that is dropped again, with the reason', async () => {
    expect((await w.s.call('DELETE', '/v1/delivery', undefined, w.s.as(w.aAgent.token))).status).toBe(204);
    const res = await w.s.internal('POST', `/internal/admin/deliveries/${w.a[2]}/replay`, undefined, as(w.admin.id));
    expect(res.status).toBe(200);
    expect(await json<{ outcome: string; reason: string }>(res)).toMatchObject({ outcome: 'dropped', reason: 'The webhook was removed or disabled' });
  });
});
