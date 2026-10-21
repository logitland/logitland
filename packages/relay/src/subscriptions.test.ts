import { verify } from '@logitland/webhooks';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  all,
  allowSubscriptions,
  echoChallenge,
  HOOK,
  HOOK_HOST,
  insertEvent,
  one,
  publish,
  recorder,
  setup,
  subscribe,
  subscribeRaw,
} from './deliveries.testkit';
import { recordGap } from './services/intake';
import type { SubscriptionRow } from './services/subscriptions';
import { BENCH, LOUNGE, seedAgent, seedChannel } from './testing';

// Replacing recordGap shows how resume calls it.
vi.mock('./services/intake', async (importOriginal) => ({ ...(await importOriginal<typeof import('./services/intake')>()), recordGap: vi.fn(async () => 1) }));

const count = async (s: Awaited<ReturnType<typeof setup>>, sql = 'SELECT COUNT(*) AS n FROM subscriptions') => (await one<{ n: number }>(s, sql)).n;
const problem = async (res: Response) => (await res.json()) as { code: string; detail?: string };

beforeEach(() => {
  vi.mocked(recordGap).mockClear();
});

describe('creating a subscription', () => {
  it('sends a signed challenge, seals the URL and secret with their associated data, and returns the secret once', async () => {
    const s = await setup();
    const rec = recorder(echoChallenge);
    s.receivers[HOOK_HOST] = rec.handler;
    const res = await subscribeRaw(s, { channel_ids: [LOUNGE, BENCH], events: ['message.created', 'message.deleted'], description: 'digest' });
    expect(res.status).toBe(201);
    const sub = (await res.json()) as Awaited<ReturnType<typeof subscribe>>;
    expect(sub).toMatchObject({ url_host: HOOK_HOST, status: 'active', failure_streak: 0, agent_id: s.agent.id, channel_ids: [LOUNGE, BENCH] });
    expect(sub.secret).toMatch(/^whsec_/);

    expect(rec.requests).toHaveLength(1);
    const challenge = rec.requests[0]!;
    expect(JSON.parse(challenge.body)).toMatchObject({ type: 'subscription.challenge', subscription_id: sub.id });
    expect(challenge.redirect).toBe('manual');
    await expect(verify(challenge.headers, challenge.body, sub.secret, { now: s.relay.now() })).resolves.toBeTruthy();

    const row = await one<SubscriptionRow>(s, 'SELECT * FROM subscriptions WHERE id = ?', sub.id);
    expect(row.url_ciphertext).not.toContain(HOOK_HOST);
    expect(row.secret_ciphertext).not.toContain(sub.secret);
    expect(await s.relay.secrets.open(row.url_ciphertext, `subscriptions.url:${sub.id}`)).toBe(HOOK);
    expect(await s.relay.secrets.open(row.secret_ciphertext, `subscriptions.secret:${sub.id}`)).toBe(sub.secret);
    await expect(s.relay.secrets.open(row.secret_ciphertext, `subscriptions.url:${sub.id}`)).rejects.toThrow();
    expect(await all(s, 'SELECT channel_id FROM subscription_channels WHERE subscription_id = ? ORDER BY channel_id', sub.id)).toEqual([
      { channel_id: LOUNGE },
      { channel_id: BENCH },
    ]);
    expect(await one(s, 'SELECT actor_type, actor_id, action FROM audit_log WHERE target_id = ?', sub.id)).toEqual({
      actor_type: 'agent',
      actor_id: s.agent.id,
      action: 'subscription.created',
    });

    const list = (await (await s.call('GET', '/v1/subscriptions', undefined, s.auth)).json()) as { subscriptions: Record<string, unknown>[] };
    expect(list.subscriptions).toHaveLength(1);
    expect(list.subscriptions[0]).toMatchObject({ id: sub.id, description: 'digest' });
    expect(list.subscriptions[0]).not.toHaveProperty('secret');
  });

  it('stores each channel and event once', async () => {
    const s = await setup();
    const sub = await subscribe(s, { channel_ids: [LOUNGE, LOUNGE, BENCH, LOUNGE], events: ['message.created', 'message.created', 'message.deleted'] });
    expect(sub.channel_ids).toEqual([LOUNGE, BENCH]);
    // Events asked for once each, and the removals that go with message text.
    expect(sub.events).toEqual(['message.created', 'message.deleted', 'message.bulk_deleted']);
    expect(await count(s, 'SELECT COUNT(*) AS n FROM subscription_channels')).toBe(2);
  });

  it('needs both subscriptions:manage and messages:read', async () => {
    const s = await setup();
    const rec = recorder(echoChallenge);
    s.receivers[HOOK_HOST] = rec.handler;
    const manager = await seedAgent(s.relay, { name: 'Manager', scopes: ['subscriptions:manage'] });
    const reader = await seedAgent(s.relay, { name: 'Reader', scopes: ['messages:read'] });
    for (const token of [manager.token, reader.token]) {
      const res = await subscribeRaw(s, {}, s.as(token));
      expect(res.status).toBe(403);
      expect((await problem(res)).code).toBe('forbidden');
    }
    expect((await s.call('GET', '/v1/subscriptions', undefined, s.as(reader.token))).status).toBe(403);
    expect((await s.call('GET', '/v1/subscriptions', undefined, s.as(manager.token))).status).toBe(200);
    expect((await s.call('GET', '/v1/subscriptions')).status).toBe(401);
    expect(rec.requests).toHaveLength(0);
    expect(await count(s)).toBe(0);
  });

  it('checks every channel is open to agents before contacting the destination', async () => {
    const s = await setup();
    const rec = recorder(echoChallenge);
    s.receivers[HOOK_HOST] = rec.handler;
    await seedChannel(s.relay, { id: '110000000000000009', name: 'staff', access: 'off' });
    for (const bad of ['110000000000000009', '110000000000000099']) {
      const res = await subscribeRaw(s, { channel_ids: [LOUNGE, bad] });
      expect(res.status).toBe(404);
      expect((await problem(res)).detail).toContain(bad);
    }
    expect(rec.requests).toHaveLength(0);
    expect(await count(s)).toBe(0);
    // Read-only channels are fine: subscribing only reads.
    expect((await subscribeRaw(s, { channel_ids: [BENCH] })).status).toBe(201);
  });
});

describe('the challenge', () => {
  it('reads at most 4096 bytes of the response, as a stream', async () => {
    const s = await setup();
    let pulled = 0;
    s.receivers[HOOK_HOST] = () =>
      new Response(
        new ReadableStream({
          pull(controller) {
            pulled += 1024;
            controller.enqueue(new Uint8Array(1024).fill(97));
          },
        }),
        { status: 200 },
      );
    const res = await subscribeRaw(s);
    expect(res.status).toBe(422);
    expect((await problem(res)).detail).toContain('4096');
    // An endless body would hang a res.text(); here we stop a few chunks past the cap.
    expect(pulled).toBeLessThanOrEqual(4096 + 3 * 1024);
    expect(await count(s)).toBe(0);
  });

  it('accepts a response of exactly 4096 bytes', async () => {
    const s = await setup();
    s.receivers[HOOK_HOST] = async (req) => {
      const challenge = ((await req.json()) as { challenge: string }).challenge;
      const bare = JSON.stringify({ challenge, pad: '' });
      return new Response(JSON.stringify({ challenge, pad: 'x'.repeat(4096 - bare.length) }));
    };
    expect((await subscribeRaw(s)).status).toBe(201);
  });

  it.each([
    ['a 500', () => new Response('SECRET-BODY-TEXT', { status: 500 }), '500'],
    ['a redirect', () => new Response(null, { status: 302, headers: { location: 'https://elsewhere.example.org/' } }), 'Redirects aren’t followed'],
    ['the wrong token', () => Response.json({ challenge: 'nope' }), 'didn’t echo'],
    ['something that isn’t JSON', () => new Response('SECRET-BODY-TEXT'), 'wasn’t JSON'],
    ['a dropped connection', () => Promise.reject(new TypeError('socket closed')), 'Couldn’t connect'],
    ['a timeout', () => Promise.reject(new DOMException('timed out', 'TimeoutError')), 'didn’t answer'],
  ])('refuses a destination that answers with %s', async (_name, reply, expected) => {
    const s = await setup();
    const elsewhere = recorder();
    s.receivers['elsewhere.example.org'] = elsewhere.handler;
    s.receivers[HOOK_HOST] = reply;
    const res = await subscribeRaw(s);
    expect(res.status).toBe(422);
    const body = await problem(res);
    expect(body.code).toBe('destination_refused');
    expect(body.detail).toContain(expected);
    expect(body.detail).not.toContain('SECRET-BODY-TEXT');
    expect(elsewhere.requests).toHaveLength(0);
    expect(await count(s)).toBe(0);
  });
});

describe('caps and limits', () => {
  it('caps subscriptions per agent, counting active and paused but not disabled', async () => {
    const s = await setup();
    const rec = recorder(echoChallenge);
    s.receivers[HOOK_HOST] = rec.handler;
    const made = [await subscribe(s), await subscribe(s), await subscribe(s)];
    const over = await subscribeRaw(s);
    expect(over.status).toBe(409);
    expect((await problem(over)).detail).toContain('3');
    expect(rec.requests).toHaveLength(3); // the refused one never reached the network

    await s.db.prepare("UPDATE subscriptions SET status = 'paused' WHERE id = ?").bind(made[0]!.id).run();
    expect((await subscribeRaw(s)).status).toBe(409);
    await s.db.prepare("UPDATE subscriptions SET status = 'disabled', paused_reason = 'Receiver answered 410 Gone' WHERE id = ?").bind(made[0]!.id).run();
    expect((await subscribeRaw(s)).status).toBe(201);
  });

  it('takes the cap from the agent’s level', async () => {
    const s = await setup({ level: 2 });
    await allowSubscriptions(s, 4, 2);
    for (let i = 0; i < 4; i++) await subscribe(s);
    expect((await subscribeRaw(s)).status).toBe(409);
  });

  it('keeps the cap under concurrent creates', async () => {
    const s = await setup();
    const results = await Promise.all(Array.from({ length: 5 }, () => subscribeRaw(s)));
    expect(results.map((r) => r.status).sort()).toEqual([201, 201, 201, 409, 409]);
    expect(await count(s)).toBe(3);
    expect(await count(s, 'SELECT COUNT(*) AS n FROM subscription_channels')).toBe(3);
  });

  it('allows five creations an hour per agent, then 429 with Retry-After', async () => {
    const s = await setup({ subscriptions: 10 });
    for (let i = 0; i < 5; i++) await subscribe(s);
    const sixth = await subscribeRaw(s);
    expect(sixth.status).toBe(429);
    expect(Number(sixth.headers.get('retry-after'))).toBeGreaterThan(0);
    expect((await problem(sixth)).code).toBe('rate_limited');
    s.advance(3600_000);
    expect((await subscribeRaw(s)).status).toBe(201);
  });

  it('allows ten creations an hour per destination host across agents', async () => {
    const s = await setup({ subscriptions: 10 });
    s.dns['other.orrery.dev'] = ['93.184.216.40'];
    s.receivers['other.orrery.dev'] = echoChallenge;
    const a = await seedAgent(s.relay, { name: 'AgentA' });
    const b = await seedAgent(s.relay, { name: 'AgentB' });
    const c = await seedAgent(s.relay, { name: 'AgentC' });
    for (let i = 0; i < 5; i++) {
      await subscribe(s, {}, s.as(a.token));
      await subscribe(s, {}, s.as(b.token));
    }
    const eleventh = await subscribeRaw(s, { url: `${HOOK}/other-path` }, s.as(c.token));
    expect(eleventh.status).toBe(429);
    expect((await problem(eleventh)).detail).toContain('destination');
    expect((await subscribeRaw(s, { url: 'https://other.orrery.dev/x' }, s.as(c.token))).status).toBe(201);
  });
});

describe('deleting a subscription', () => {
  it('disables it, drops pending deliveries and removes its channel rows', async () => {
    const s = await setup();
    const sub = await subscribe(s, { channel_ids: [LOUNGE, BENCH] });
    const { ids } = await publish(s);
    expect(ids).toHaveLength(1);

    const res = await s.call('DELETE', `/v1/subscriptions/${sub.id}`, undefined, s.auth);
    expect(res.status).toBe(204);
    expect(await one(s, 'SELECT status, paused_reason FROM subscriptions WHERE id = ?', sub.id)).toEqual({
      status: 'disabled',
      paused_reason: 'Removed by the agent',
    });
    expect(await one(s, 'SELECT status, next_attempt_at, last_error FROM deliveries WHERE id = ?', ids[0])).toMatchObject({
      status: 'dropped',
      next_attempt_at: null,
    });
    expect(await count(s, 'SELECT COUNT(*) AS n FROM subscription_channels')).toBe(0);
    expect(await one(s, "SELECT actor_id, action FROM audit_log WHERE action = 'subscription.deleted'")).toEqual({
      actor_id: s.agent.id,
      action: 'subscription.deleted',
    });

    expect(((await (await s.call('GET', '/v1/subscriptions', undefined, s.auth)).json()) as { subscriptions: unknown[] }).subscriptions).toEqual([]);
    expect((await s.call('DELETE', `/v1/subscriptions/${sub.id}`, undefined, s.auth)).status).toBe(404);
    expect((await publish(s)).ids).toEqual([]);
  });

  it('is invisible to other agents', async () => {
    const s = await setup();
    const sub = await subscribe(s);
    const other = await seedAgent(s.relay, { name: 'Other' });
    const auth = s.as(other.token);
    expect(((await (await s.call('GET', '/v1/subscriptions', undefined, auth)).json()) as { subscriptions: unknown[] }).subscriptions).toEqual([]);
    for (const [method, path] of [
      ['DELETE', ''],
      ['POST', '/resume'],
      ['POST', '/rotate-secret'],
      ['GET', '/deliveries'],
    ] as const) {
      expect((await s.call(method, `/v1/subscriptions/${sub.id}${path}`, undefined, auth)).status, `${method} ${path}`).toBe(404);
    }
    expect(await one(s, 'SELECT status FROM subscriptions WHERE id = ?', sub.id)).toEqual({ status: 'active' });
  });
});

describe('resuming a subscription', () => {
  const pause = (s: Awaited<ReturnType<typeof setup>>, id: string, pausedAt = '2026-10-19T03:10:00.000Z') =>
    s.db
      .prepare(
        "UPDATE subscriptions SET status = 'paused', failure_streak = 50, paused_reason = 'Paused after 50 failed deliveries in a row.', paused_at = ? WHERE id = ?",
      )
      .bind(pausedAt, id)
      .run();

  it('resets the streak and records a gap over the paused window for the subscription’s channels', async () => {
    const s = await setup();
    const sub = await subscribe(s, { channel_ids: [LOUNGE, BENCH] });
    await pause(s, sub.id);
    s.advance(20 * 60_000);

    const res = await s.call('POST', `/v1/subscriptions/${sub.id}/resume`, undefined, s.auth);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ id: sub.id, status: 'active', failure_streak: 0, paused_reason: null });
    expect(await one(s, 'SELECT paused_at FROM subscriptions WHERE id = ?', sub.id)).toEqual({ paused_at: null });
    expect(recordGap).toHaveBeenCalledTimes(1);
    expect(recordGap).toHaveBeenCalledWith(
      s.relay,
      expect.objectContaining({
        channelIds: expect.arrayContaining([LOUNGE, BENCH]),
        windowStart: '2026-10-19T03:10:00.000Z',
        windowEnd: '2026-10-19T03:20:00.000Z',
      }),
    );
    expect(vi.mocked(recordGap).mock.calls[0]![1].reason).toContain('GET /v1/events');
    expect(await one(s, "SELECT actor_id FROM audit_log WHERE action = 'subscription.resumed'")).toEqual({ actor_id: s.agent.id });
  });

  it('starts the window at the first undelivered delivery since the last success when that is earlier than the pause', async () => {
    const s = await setup();
    const sub = await subscribe(s);
    const insert = async (status: string, createdAt: string, deliveredAt: string | null) => {
      const event = await insertEvent(s);
      await s.db
        .prepare(
          "INSERT INTO deliveries (id, subscription_id, event_id, event_type, status, attempts, created_at, delivered_at) VALUES (?, ?, ?, 'message.created', ?, 1, ?, ?)",
        )
        .bind(`del_${event.id.slice(4)}`, sub.id, event.id, status, createdAt, deliveredAt)
        .run();
    };
    await insert('failed', '2026-10-19T02:30:00.000Z', null); // before the last success: not part of the outage
    await insert('delivered', '2026-10-19T02:40:00.000Z', '2026-10-19T02:41:00.000Z');
    await insert('failed', '2026-10-19T02:50:00.000Z', null);
    await insert('dropped', '2026-10-19T03:05:00.000Z', null);
    await pause(s, sub.id, '2026-10-19T03:10:00.000Z');

    await s.call('POST', `/v1/subscriptions/${sub.id}/resume`, undefined, s.auth);
    expect(vi.mocked(recordGap).mock.calls[0]![1].windowStart).toBe('2026-10-19T02:50:00.000Z');
  });

  it('skips channels that are no longer open to agents', async () => {
    const s = await setup();
    const sub = await subscribe(s, { channel_ids: [LOUNGE, BENCH] });
    await pause(s, sub.id);
    await s.db.prepare("UPDATE channels SET agent_access = 'off' WHERE id = ?").bind(BENCH).run();
    await s.call('POST', `/v1/subscriptions/${sub.id}/resume`, undefined, s.auth);
    expect(vi.mocked(recordGap).mock.calls[0]![1].channelIds).toEqual([LOUNGE]);

    await pause(s, sub.id);
    await s.db.prepare("UPDATE channels SET agent_access = 'off' WHERE id = ?").bind(LOUNGE).run();
    vi.mocked(recordGap).mockClear();
    expect((await s.call('POST', `/v1/subscriptions/${sub.id}/resume`, undefined, s.auth)).status).toBe(200);
    expect(recordGap).not.toHaveBeenCalled();
  });

  it('resumes once: a second call finds it active and records nothing more', async () => {
    const s = await setup();
    const sub = await subscribe(s);
    await pause(s, sub.id);
    await s.call('POST', `/v1/subscriptions/${sub.id}/resume`, undefined, s.auth);
    const again = await s.call('POST', `/v1/subscriptions/${sub.id}/resume`, undefined, s.auth);
    expect(again.status).toBe(200);
    expect(await again.json()).toMatchObject({ status: 'active' });
    expect(recordGap).toHaveBeenCalledTimes(1);
  });

  it('refuses a disabled subscription', async () => {
    const s = await setup();
    const sub = await subscribe(s);
    await s.db.prepare("UPDATE subscriptions SET status = 'disabled', paused_reason = 'Receiver answered 410 Gone' WHERE id = ?").bind(sub.id).run();
    const res = await s.call('POST', `/v1/subscriptions/${sub.id}/resume`, undefined, s.auth);
    expect(res.status).toBe(409);
    expect((await problem(res)).detail).toContain('Create a new one');
  });

  it('stays resumed when recording the gap fails', async () => {
    const s = await setup();
    const sub = await subscribe(s);
    await pause(s, sub.id);
    vi.mocked(recordGap).mockRejectedValueOnce(new Error('intake is down'));
    const res = await s.call('POST', `/v1/subscriptions/${sub.id}/resume`, undefined, s.auth);
    expect(res.status).toBe(200);
    expect(await one(s, 'SELECT status FROM subscriptions WHERE id = ?', sub.id)).toEqual({ status: 'active' });
    expect(s.log.lines.some((l) => l.event === 'subscription.gap_failed')).toBe(true);
  });
});

describe('rotating the secret', () => {
  it('issues a new secret and keeps the previous one for 24 hours, sealed under its own associated data', async () => {
    const s = await setup();
    const sub = await subscribe(s);
    const res = await s.call('POST', `/v1/subscriptions/${sub.id}/rotate-secret`, undefined, s.auth);
    expect(res.status).toBe(200);
    const rotated = (await res.json()) as { secret: string; previous_valid_until: string };
    expect(rotated.secret).toMatch(/^whsec_/);
    expect(rotated.secret).not.toBe(sub.secret);
    expect(rotated.previous_valid_until).toBe('2026-10-20T03:00:00.000Z');

    const row = await one<SubscriptionRow>(s, 'SELECT * FROM subscriptions WHERE id = ?', sub.id);
    expect(await s.relay.secrets.open(row.secret_ciphertext, `subscriptions.secret:${sub.id}`)).toBe(rotated.secret);
    expect(await s.relay.secrets.open(row.secret_previous_ciphertext!, `subscriptions.secret_previous:${sub.id}`)).toBe(sub.secret);
    await expect(s.relay.secrets.open(row.secret_previous_ciphertext!, `subscriptions.secret:${sub.id}`)).rejects.toThrow();
    expect(row.secret_previous_until).toBe(rotated.previous_valid_until);
    expect(await one(s, "SELECT actor_id FROM audit_log WHERE action = 'subscription.secret_rotated'")).toEqual({ actor_id: s.agent.id });

    // A second rotation keeps only the most recent previous secret.
    const again = (await (await s.call('POST', `/v1/subscriptions/${sub.id}/rotate-secret`, undefined, s.auth)).json()) as { secret: string };
    const row2 = await one<SubscriptionRow>(s, 'SELECT * FROM subscriptions WHERE id = ?', sub.id);
    expect(await s.relay.secrets.open(row2.secret_previous_ciphertext!, `subscriptions.secret_previous:${sub.id}`)).toBe(rotated.secret);
    expect(await s.relay.secrets.open(row2.secret_ciphertext, `subscriptions.secret:${sub.id}`)).toBe(again.secret);
  });

  it('lets only one of two simultaneous rotations win', async () => {
    const s = await setup();
    const sub = await subscribe(s);
    const results = await Promise.all([
      s.call('POST', `/v1/subscriptions/${sub.id}/rotate-secret`, undefined, s.auth),
      s.call('POST', `/v1/subscriptions/${sub.id}/rotate-secret`, undefined, s.auth),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
  });

  it('refuses a disabled subscription', async () => {
    const s = await setup();
    const sub = await subscribe(s);
    await s.db.prepare("UPDATE subscriptions SET status = 'disabled', paused_reason = 'Receiver answered 410 Gone' WHERE id = ?").bind(sub.id).run();
    expect((await s.call('POST', `/v1/subscriptions/${sub.id}/rotate-secret`, undefined, s.auth)).status).toBe(409);
  });
});
