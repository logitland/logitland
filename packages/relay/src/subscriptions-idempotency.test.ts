import { describe, expect, it } from 'vitest';
import { HOOK, HOOK_HOST, all, echoChallenge, one, recorder, setup, type Created, type Setup } from './deliveries.testkit';
import { BENCH, LOUNGE } from './testing';

const create = (s: Setup, key: string | undefined, body: Record<string, unknown> = {}) =>
  s.call(
    'POST',
    '/v1/subscriptions',
    { url: HOOK, events: ['message.created'], channel_ids: [LOUNGE], ...body },
    { ...s.auth, ...(key ? { 'idempotency-key': key } : {}) },
  );

const problem = async (res: Response) => (await res.json()) as { code: string; detail?: string; errors?: { path: string; message: string }[] };

describe('POST /v1/subscriptions with an Idempotency-Key', () => {
  it('returns the first subscription, with its secret, when the same request is sent again', async () => {
    const s = await setup();
    const rec = recorder(echoChallenge);
    s.receivers[HOOK_HOST] = rec.handler;
    const first = await create(s, 'create-orrery-0001');
    expect(first.status).toBe(201);
    expect(first.headers.get('idempotent-replayed')).toBeNull();
    const a = (await first.json()) as Created;

    const second = await create(s, 'create-orrery-0001');
    expect(second.status).toBe(201);
    expect(second.headers.get('idempotent-replayed')).toBe('true');
    const b = (await second.json()) as Created;
    expect(b).toEqual(a);
    expect(b.secret).toBe(a.secret);
    expect(b).not.toHaveProperty('replayed');
    expect(await one(s, 'SELECT COUNT(*) AS n FROM subscriptions')).toEqual({ n: 1 });
    expect(await one(s, 'SELECT COUNT(*) AS n FROM subscription_channels')).toEqual({ n: 1 });
    // One challenge, not two; and the retry did not count against the creation limits.
    expect(rec.requests).toHaveLength(1);
    expect(await all(s, "SELECT count FROM rate_counters WHERE key LIKE 'sub:create:%'")).toEqual([{ count: 1 }]);
    expect(await all(s, "SELECT 1 FROM audit_log WHERE action = 'subscription.created'")).toHaveLength(1);
  });

  it('returns the same subscription when the retry spells the request differently but asks for the same thing', async () => {
    const s = await setup();
    const a = (await (
      await create(s, 'create-orrery-0002', { events: ['message.created', 'message.updated'], channel_ids: [LOUNGE, BENCH] })
    ).json()) as Created;
    const b = await create(s, 'create-orrery-0002', { events: ['message.updated', 'message.created', 'message.created'], channel_ids: [BENCH, LOUNGE] });
    expect(((await b.json()) as Created).id).toBe(a.id);
  });

  it('refuses the key for a different request', async () => {
    const s = await setup();
    await create(s, 'create-orrery-0003');
    for (const other of [{ events: ['message.deleted'] }, { channel_ids: [BENCH] }, { description: 'other' }, { url: `${HOOK}/other` }]) {
      const res = await create(s, 'create-orrery-0003', other);
      expect(res.status, JSON.stringify(other)).toBe(409);
      expect((await problem(res)).code).toBe('idempotency_conflict');
    }
    expect(await one(s, 'SELECT COUNT(*) AS n FROM subscriptions')).toEqual({ n: 1 });
  });

  it('keeps keys apart per agent', async () => {
    const s = await setup();
    const { seedAgent } = await import('./testing');
    const other = await seedAgent(s.relay, { name: 'Other' });
    const a = (await (await create(s, 'shared-key-0001')).json()) as Created;
    const res = await s.call(
      'POST',
      '/v1/subscriptions',
      { url: HOOK, events: ['message.created'], channel_ids: [LOUNGE] },
      { ...s.as(other.token), 'idempotency-key': 'shared-key-0001' },
    );
    expect(res.status).toBe(201);
    expect(((await res.json()) as Created).id).not.toBe(a.id);
  });

  it('adds a second subscription when there is no key, as before', async () => {
    const s = await setup();
    expect((await create(s, undefined)).status).toBe(201);
    expect((await create(s, undefined)).status).toBe(201);
    expect(await one(s, 'SELECT COUNT(*) AS n FROM subscriptions')).toEqual({ n: 2 });
  });

  it('refuses a key that is not 8 to 128 printable characters', async () => {
    const s = await setup();
    for (const key of ['short', 'has space in it', 'x'.repeat(129)]) {
      const res = await create(s, key);
      expect(res.status, key).toBe(400);
    }
    expect(await one(s, 'SELECT COUNT(*) AS n FROM subscriptions')).toEqual({ n: 0 });
  });

  it('settles two requests with the same key sent at once on one subscription', async () => {
    const s = await setup();
    const [x, y] = await Promise.all([create(s, 'create-orrery-0004'), create(s, 'create-orrery-0004')]);
    expect([x.status, y.status]).toEqual([201, 201]);
    const a = (await x.json()) as Created;
    const b = (await y.json()) as Created;
    expect(a.id).toBe(b.id);
    expect(a.secret).toBe(b.secret);
    expect(await one(s, 'SELECT COUNT(*) AS n FROM subscriptions')).toEqual({ n: 1 });
  });

  it('does not bring back a subscription the agent deleted', async () => {
    const s = await setup();
    const a = (await (await create(s, 'create-orrery-0005')).json()) as Created;
    expect((await s.call('DELETE', `/v1/subscriptions/${a.id}`, undefined, s.auth)).status).toBe(204);
    const res = await create(s, 'create-orrery-0005');
    expect(res.status).toBe(409);
    expect((await problem(res)).detail).toContain('deleted');
    expect((await create(s, 'create-orrery-0006')).status).toBe(201);
  });

  it('still counts a retry that follows a failed challenge as a new attempt', async () => {
    const s = await setup();
    let answer = false;
    s.receivers[HOOK_HOST] = async (req) =>
      answer ? Response.json({ challenge: ((await req.json()) as { challenge: string }).challenge }) : new Response(null, { status: 500 });
    expect((await create(s, 'create-orrery-0007')).status).toBe(422);
    expect(await one(s, 'SELECT COUNT(*) AS n FROM subscriptions')).toEqual({ n: 0 });
    answer = true;
    expect((await create(s, 'create-orrery-0007')).status).toBe(201);
  });
});

describe('the events a subscription gets', () => {
  it('include the removals whenever it gets message text, in the response and the list', async () => {
    const s = await setup();
    for (const [asked, got] of [
      [['message.created'], ['message.created', 'message.deleted', 'message.bulk_deleted']],
      [['message.updated'], ['message.updated', 'message.deleted', 'message.bulk_deleted']],
      [
        ['message.updated', 'message.deleted'],
        ['message.updated', 'message.deleted', 'message.bulk_deleted'],
      ],
      [['message.deleted'], ['message.deleted']],
      [
        ['message.bulk_deleted', 'subscription.gap'],
        ['message.bulk_deleted', 'subscription.gap'],
      ],
      [['subscription.gap'], ['subscription.gap']],
    ] as const) {
      const res = await s.call('POST', '/v1/subscriptions', { url: HOOK, events: asked, channel_ids: [LOUNGE] }, s.auth);
      const sub = (await res.json()) as Created;
      expect(sub.events, asked.join()).toEqual(got);
      await s.call('DELETE', `/v1/subscriptions/${sub.id}`, undefined, s.auth);
      s.advance(3_600_000); // five creates an hour
    }
    const kept = (await (await create(s, undefined)).json()) as Created;
    const listed = (await (await s.call('GET', '/v1/subscriptions', undefined, s.auth)).json()) as { subscriptions: Created[] };
    expect(listed.subscriptions.find((x) => x.id === kept.id)!.events).toEqual(['message.created', 'message.deleted', 'message.bulk_deleted']);
  });

  it('are listed with the removals even for a row stored without them', async () => {
    const s = await setup();
    const sub = (await (await create(s, undefined)).json()) as Created;
    await s.db.prepare('UPDATE subscriptions SET events = \'["message.created"]\' WHERE id = ?').bind(sub.id).run();
    const listed = (await (await s.call('GET', '/v1/subscriptions', undefined, s.auth)).json()) as { subscriptions: Created[] };
    expect(listed.subscriptions[0]!.events).toEqual(['message.created', 'message.deleted', 'message.bulk_deleted']);
  });
});

describe('a destination the relay will not take', () => {
  it('says once what is required, whichever part is wrong', async () => {
    const s = await setup();
    for (const url of [
      'http://hooks.orrery.dev/in',
      'https://localhost/in',
      'https://10.0.0.1/in',
      'https://[::1]/in',
      'not a url',
      'ftp://hooks.orrery.dev/in',
      'https://intranet/in',
    ]) {
      const res = await create(s, undefined, { url });
      expect(res.status, url).toBe(400);
      const body = await problem(res);
      expect(body.errors, url).toEqual([{ path: 'url', message: 'Use an https URL on a public hostname, port 443 or 8443' }]);
    }
  });

  it('still explains the rest in plain words', async () => {
    const s = await setup();
    const port = await create(s, undefined, { url: 'https://hooks.orrery.dev:22/in' });
    expect(port.status).toBe(422);
    expect((await problem(port)).detail).toBe('Use port 443 or 8443');
    const own = await create(s, undefined, { url: 'https://my.workers.dev/in' });
    expect((await problem(own)).detail).toBe('That host belongs to Logitland');
  });
});
