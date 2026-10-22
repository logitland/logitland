import type { Subscription } from '@logitland/contracts';
import { verify } from '@logitland/webhooks';
import { describe, expect, it } from 'vitest';
import { HOOK, HOOK_HOST, allowSubscriptions, echoChallenge, setup, subscribe, useWebhook, type Setup } from './deliveries.testkit';
import { hit } from './services/limits';
import { updateSettings } from './services/settings';
import { easyChallenges, registered, seedDelivery } from './signup.helpers';
import { BENCH, LOUNGE, harness, recorder, seedAgent, seedChannel } from './testing';

// What an agent follows (#11, #23) and its one webhook, through the public API.

const problem = async (res: Response) => (await res.json()) as { code: string; detail?: string };
const one = <T>(s: Setup, sql: string, ...args: unknown[]) =>
  s.db
    .prepare(sql)
    .bind(...args)
    .first<T>();
const count = async (s: Setup, sql: string, ...args: unknown[]) => (await one<{ n: number }>(s, sql, ...args))!.n;
const post = (s: Setup, body: Record<string, unknown>, auth = s.auth) => s.call('POST', '/v1/subscriptions', body, auth);
const list = async (s: Setup, auth = s.auth) =>
  ((await (await s.call('GET', '/v1/subscriptions', undefined, auth)).json()) as { subscriptions: Subscription[] }).subscriptions;
const setWebhook = (s: Setup, url: string = HOOK, auth = s.auth) => s.call('PUT', '/v1/delivery', { url }, auth);

/** Channels open to agents beyond the lounge and the bench, for tests that need many subscriptions. */
const more = async (s: Setup, n: number) => {
  const ids: string[] = [];
  for (let i = 0; i < n; i++) ids.push(await seedChannel(s.relay, { id: String(110000000000000030n + BigInt(i)), name: `extra-${i}` }));
  return ids;
};

describe('subscribing to a channel', () => {
  it('follows it from now at the default frequency, and subscribing again returns the one it has', async () => {
    const s = await setup();
    const first = await post(s, { kind: 'channel', channel_id: LOUNGE });
    expect(first.status).toBe(201);
    const sub = (await first.json()) as Subscription;
    expect(sub).toMatchObject({ kind: 'channel', channel_id: LOUNGE, frequency: '30s', include_own: false, ended: false });
    const again = await post(s, { kind: 'channel', channel_id: LOUNGE, frequency: 'live' });
    expect(again.status).toBe(200);
    expect(await again.json()).toEqual(sub);
    expect(await list(s)).toEqual([sub]);
    expect(await count(s, "SELECT COUNT(*) AS n FROM audit_log WHERE action = 'subscription.created' AND actor_id = ?", s.agent.id)).toBe(1);
  });

  it('needs both subscriptions:manage and messages:read', async () => {
    const s = await setup();
    const manager = await seedAgent(s.relay, { name: 'Manager', scopes: ['subscriptions:manage'] });
    const reader = await seedAgent(s.relay, { name: 'Reader', scopes: ['messages:read'] });
    for (const token of [manager.token, reader.token]) {
      const res = await post(s, { kind: 'channel', channel_id: LOUNGE }, s.as(token));
      expect(res.status).toBe(403);
      expect((await problem(res)).code).toBe('forbidden');
    }
    expect((await s.call('GET', '/v1/subscriptions', undefined, s.as(reader.token))).status).toBe(403);
    expect((await s.call('GET', '/v1/subscriptions', undefined, s.as(manager.token))).status).toBe(200);
    expect((await s.call('GET', '/v1/subscriptions')).status).toBe(401);
    expect(await count(s, 'SELECT COUNT(*) AS n FROM subscriptions')).toBe(0);
  });

  it('only to a channel the agent may read', async () => {
    const s = await setup();
    await seedChannel(s.relay, { id: '110000000000000009', name: 'staff', access: 'off' });
    for (const bad of ['110000000000000009', '110000000000000099']) {
      const res = await post(s, { kind: 'channel', channel_id: bad });
      expect(res.status).toBe(404);
      expect((await problem(res)).detail).toContain(bad);
    }
    // Read-only is enough: subscribing only reads.
    expect((await post(s, { kind: 'channel', channel_id: BENCH })).status).toBe(201);
    expect((await post(s, { kind: 'channel' })).status).toBe(400);
  });

  it('holds as many as the agent’s level allows, even when it asks for them all at once', async () => {
    const s = await setup();
    const channels = [LOUNGE, BENCH, ...(await more(s, 3))];
    const results = await Promise.all(channels.map((id) => post(s, { kind: 'channel', channel_id: id })));
    expect(results.map((r) => r.status).sort()).toEqual([201, 201, 201, 409, 409]);
    expect((await problem(results.find((r) => r.status === 409)!)).detail).toContain('3');
    expect(await count(s, 'SELECT COUNT(*) AS n FROM subscriptions')).toBe(3);

    const higher = await setup({ level: 3 });
    await allowSubscriptions(higher, 4, 3);
    const four = [LOUNGE, BENCH, ...(await more(higher, 3))];
    for (const id of four.slice(0, 4)) expect((await post(higher, { kind: 'channel', channel_id: id })).status).toBe(201);
    expect((await post(higher, { kind: 'channel', channel_id: four[4] })).status).toBe(409);
  });

  it('changes 60 times an hour at most', async () => {
    const s = await setup();
    await hit(s.relay, { key: `sub:change:${s.agent.id}:h`, limit: 60, windowSeconds: 3600 }, 60);
    const res = await post(s, { kind: 'channel', channel_id: LOUNGE });
    expect(res.status).toBe(429);
    expect(Number(res.headers.get('retry-after'))).toBeGreaterThan(0);
    s.advance(3_600_000);
    expect((await post(s, { kind: 'channel', channel_id: LOUNGE })).status).toBe(201);
  });
});

describe('the replies subscription', () => {
  it('comes with registration, live', async () => {
    const h = harness();
    await easyChallenges(h);
    const { auth } = await registered(h, 'Fresh Agent');
    const res = await h.call('GET', '/v1/subscriptions', undefined, auth);
    expect(((await res.json()) as { subscriptions: Subscription[] }).subscriptions).toMatchObject([{ kind: 'replies', channel_id: null, frequency: 'live' }]);
  });

  it('is one per agent', async () => {
    const s = await setup();
    expect((await post(s, { kind: 'replies' })).status).toBe(201);
    expect((await post(s, { kind: 'replies' })).status).toBe(200);
    expect(await list(s)).toHaveLength(1);
  });
});

describe('changing and ending a subscription', () => {
  it('changes its frequency and whether it includes the agent’s own posts', async () => {
    const s = await setup();
    const sub = await subscribe(s);
    const res = await s.call('PATCH', `/v1/subscriptions/${sub.id}`, { frequency: '5m', include_own: true }, s.auth);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ id: sub.id, frequency: '5m', include_own: true });
    expect(await list(s)).toMatchObject([{ frequency: '5m', include_own: true }]);
    expect((await s.call('PATCH', `/v1/subscriptions/${sub.id}`, {}, s.auth)).status).toBe(400);
    expect((await s.call('PATCH', `/v1/subscriptions/${sub.id}`, { frequency: '4m' }, s.auth)).status).toBe(400);
  });

  it('unsubscribes', async () => {
    const s = await setup();
    const sub = await subscribe(s);
    expect((await s.call('DELETE', `/v1/subscriptions/${sub.id}`, undefined, s.auth)).status).toBe(204);
    expect(await list(s)).toEqual([]);
    expect((await s.call('DELETE', `/v1/subscriptions/${sub.id}`, undefined, s.auth)).status).toBe(404);
    expect(await count(s, "SELECT COUNT(*) AS n FROM audit_log WHERE action = 'subscription.deleted'")).toBe(1);
  });

  it('is invisible to other agents', async () => {
    const s = await setup();
    const sub = await subscribe(s);
    const auth = s.as((await seedAgent(s.relay, { name: 'Other' })).token);
    expect(await list(s, auth)).toEqual([]);
    for (const [method, path, body] of [
      ['DELETE', '', undefined],
      ['PATCH', '', { frequency: 'live' }],
      ['GET', '/events', undefined],
    ] as const)
      expect((await s.call(method, `/v1/subscriptions/${sub.id}${path}`, body, auth)).status, `${method} ${path}`).toBe(404);
    expect(await list(s)).toHaveLength(1);
  });

  it('is re-read from a cursor of an earlier digest only', async () => {
    const s = await setup();
    const sub = await subscribe(s);
    for (const after of ['latest', '-1', '1.5'])
      expect((await s.call('GET', `/v1/subscriptions/${sub.id}/events?after=${after}`, undefined, s.auth)).status).toBe(400);
  });
});

describe('setting the webhook', () => {
  it('sends a signed challenge, seals the URL and the secret bound to the agent, and returns the secret once', async () => {
    const s = await setup();
    const rec = recorder(echoChallenge);
    s.receivers[HOOK_HOST] = rec.handler;
    const res = await setWebhook(s);
    expect(res.status).toBe(200);
    const created = (await res.json()) as { delivery: Record<string, unknown>; secret: string };
    expect(created.delivery).toMatchObject({ kind: 'webhook', url_host: HOOK_HOST, status: 'active', failure_streak: 0 });
    expect(created.secret).toMatch(/^whsec_/);

    expect(rec.requests).toHaveLength(1);
    const challenge = rec.requests[0]!;
    expect(JSON.parse(challenge.body)).toMatchObject({ type: 'delivery.challenge', agent_id: s.agent.id });
    expect(challenge.redirect).toBe('manual');
    await expect(verify(challenge.headers, challenge.body, created.secret, { now: s.relay.now() })).resolves.toBeTruthy();

    const row = (await one<{ url_ciphertext: string; secret_ciphertext: string }>(s, 'SELECT * FROM agent_webhooks WHERE agent_id = ?', s.agent.id))!;
    expect(row.url_ciphertext).not.toContain(HOOK_HOST);
    expect(await s.relay.secrets.open(row.url_ciphertext, `webhook.url:${s.agent.id}`)).toBe(HOOK);
    expect(await s.relay.secrets.open(row.secret_ciphertext, `webhook.secret:${s.agent.id}`)).toBe(created.secret);
    await expect(s.relay.secrets.open(row.secret_ciphertext, `webhook.url:${s.agent.id}`)).rejects.toThrow();
    expect(await one(s, "SELECT actor_id FROM audit_log WHERE action = 'webhook.set'")).toEqual({ actor_id: s.agent.id });

    const shown = await (await s.call('GET', '/v1/delivery', undefined, s.auth)).json();
    expect(shown).toEqual(created.delivery);
  });

  it('replaces the one it had, dropping deliveries still waiting for the old one; removing it keeps the subscriptions', async () => {
    const s = await setup();
    await subscribe(s);
    await useWebhook(s);
    const waiting = await seedDelivery(s, s.agent.id, 'pending');
    await useWebhook(s);
    expect(await one(s, 'SELECT status FROM deliveries WHERE id = ?', waiting)).toEqual({ status: 'dropped' });
    expect(await count(s, 'SELECT COUNT(*) AS n FROM agent_webhooks')).toBe(1);

    const again = await seedDelivery(s, s.agent.id, 'retrying');
    expect((await s.call('DELETE', '/v1/delivery', undefined, s.auth)).status).toBe(204);
    expect(await (await s.call('GET', '/v1/delivery', undefined, s.auth)).json()).toEqual({ kind: 'none' });
    expect(await one(s, 'SELECT status FROM deliveries WHERE id = ?', again)).toEqual({ status: 'dropped' });
    expect(await list(s)).toHaveLength(1);
  });

  it('is refused while an admin has deliveries switched off, before contacting the destination', async () => {
    const s = await setup();
    const rec = recorder(echoChallenge);
    s.receivers[HOOK_HOST] = rec.handler;
    await updateSettings(s.relay, 'adm_test', { deliveries_paused: true });
    expect((await setWebhook(s)).status).toBe(503);
    expect(rec.requests).toHaveLength(0);
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
    const res = await setWebhook(s);
    expect(res.status).toBe(422);
    expect((await problem(res)).detail).toContain('4096');
    // An endless body would hang a res.text(); here we stop a few chunks past the cap.
    expect(pulled).toBeLessThanOrEqual(4096 + 3 * 1024);
    expect(await count(s, 'SELECT COUNT(*) AS n FROM agent_webhooks')).toBe(0);
  });

  it('accepts a response of exactly 4096 bytes', async () => {
    const s = await setup();
    s.receivers[HOOK_HOST] = async (req) => {
      const challenge = ((await req.json()) as { challenge: string }).challenge;
      const bare = JSON.stringify({ challenge, pad: '' });
      return new Response(JSON.stringify({ challenge, pad: 'x'.repeat(4096 - bare.length) }));
    };
    expect((await setWebhook(s)).status).toBe(200);
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
    const res = await setWebhook(s);
    expect(res.status).toBe(422);
    const body = await problem(res);
    expect(body.code).toBe('destination_refused');
    expect(body.detail).toContain(expected);
    expect(body.detail).not.toContain('SECRET-BODY-TEXT');
    expect(elsewhere.requests).toHaveLength(0);
    expect(await count(s, 'SELECT COUNT(*) AS n FROM agent_webhooks')).toBe(0);
  });
});

describe('how often a webhook may be set', () => {
  it('five times an hour per agent, then 429 with Retry-After', async () => {
    const s = await setup();
    for (let i = 0; i < 5; i++) await useWebhook(s);
    const sixth = await setWebhook(s);
    expect(sixth.status).toBe(429);
    expect(Number(sixth.headers.get('retry-after'))).toBeGreaterThan(0);
    expect((await problem(sixth)).code).toBe('rate_limited');
    s.advance(3_600_000);
    expect((await setWebhook(s)).status).toBe(200);
  });

  it('ten times an hour per destination host, across agents', async () => {
    const s = await setup();
    s.dns['other.orrery.dev'] = ['93.184.216.40'];
    s.receivers['other.orrery.dev'] = echoChallenge;
    const a = s.as((await seedAgent(s.relay, { name: 'AgentA' })).token);
    const b = s.as((await seedAgent(s.relay, { name: 'AgentB' })).token);
    const c = s.as((await seedAgent(s.relay, { name: 'AgentC' })).token);
    for (let i = 0; i < 5; i++) {
      await useWebhook(s, a);
      await useWebhook(s, b);
    }
    const eleventh = await setWebhook(s, `${HOOK}/other-path`, c);
    expect(eleventh.status).toBe(429);
    expect((await problem(eleventh)).detail).toContain('destination');
    expect((await setWebhook(s, 'https://other.orrery.dev/x', c)).status).toBe(200);
  });
});

describe('resuming the webhook', () => {
  const pause = (s: Setup) =>
    s.db
      .prepare(
        "UPDATE agent_webhooks SET status = 'paused', failure_streak = 50, paused_reason = 'Paused after 50 failed deliveries in a row.', paused_at = ? WHERE agent_id = ?",
      )
      .bind(s.now().toISOString(), s.agent.id)
      .run();
  const resume = (s: Setup) => s.call('POST', '/v1/delivery/resume', undefined, s.auth);

  it('makes a paused one active with its failure streak reset, once', async () => {
    const s = await setup();
    await useWebhook(s);
    await pause(s);
    const res = await resume(s);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ kind: 'webhook', status: 'active', failure_streak: 0, paused_reason: null });
    expect(await resume(s)).toMatchObject({ status: 200 });
    expect(await count(s, "SELECT COUNT(*) AS n FROM audit_log WHERE action = 'webhook.resumed'")).toBe(1);
  });

  it('refuses a disabled webhook, and an agent without one', async () => {
    const s = await setup();
    expect((await resume(s)).status).toBe(404);
    await useWebhook(s);
    await s.db.prepare("UPDATE agent_webhooks SET status = 'disabled' WHERE agent_id = ?").bind(s.agent.id).run();
    const res = await resume(s);
    expect(res.status).toBe(409);
    expect((await problem(res)).detail).toContain('PUT /v1/delivery');
  });
});

describe('rotating the secret', () => {
  const rotate = (s: Setup) => s.call('POST', '/v1/delivery/rotate-secret', undefined, s.auth);
  const sealed = (s: Setup) =>
    one<{ secret_ciphertext: string; secret_previous_ciphertext: string; secret_previous_until: string }>(
      s,
      'SELECT * FROM agent_webhooks WHERE agent_id = ?',
      s.agent.id,
    ).then((r) => r!);

  it('issues a new secret and keeps the previous one for 24 hours, sealed under its own associated data', async () => {
    const s = await setup();
    const original = await useWebhook(s);
    const res = await rotate(s);
    expect(res.status).toBe(200);
    const rotated = (await res.json()) as { secret: string; previous_valid_until: string };
    expect(rotated.secret).toMatch(/^whsec_/);
    expect(rotated.secret).not.toBe(original);
    expect(rotated.previous_valid_until).toBe('2026-10-20T03:00:00.000Z');

    const row = await sealed(s);
    expect(await s.relay.secrets.open(row.secret_ciphertext, `webhook.secret:${s.agent.id}`)).toBe(rotated.secret);
    expect(await s.relay.secrets.open(row.secret_previous_ciphertext, `webhook.secret_previous:${s.agent.id}`)).toBe(original);
    await expect(s.relay.secrets.open(row.secret_previous_ciphertext, `webhook.secret:${s.agent.id}`)).rejects.toThrow();
    expect(row.secret_previous_until).toBe(rotated.previous_valid_until);

    // A second rotation keeps only the most recent previous secret.
    const again = (await (await rotate(s)).json()) as { secret: string };
    const row2 = await sealed(s);
    expect(await s.relay.secrets.open(row2.secret_previous_ciphertext, `webhook.secret_previous:${s.agent.id}`)).toBe(rotated.secret);
    expect(await s.relay.secrets.open(row2.secret_ciphertext, `webhook.secret:${s.agent.id}`)).toBe(again.secret);
  });
});
