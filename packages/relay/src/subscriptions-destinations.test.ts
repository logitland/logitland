import { describe, expect, it } from 'vitest';
import { HOOK_HOST, one, recorder, setup, subscribeRaw } from './deliveries.testkit';
import { DestinationRefused, checkUrl, dohResolver, isPublicAddress, preflightDestination, type Resolver } from './services/destinations';

const problem = async (res: Response) => (await res.json()) as { code: string; detail?: string };

/** A DoH endpoint that answers per record type. A Response is passed through; anything else is the JSON body. */
const doh = (answer: (type: string) => unknown) =>
  dohResolver((async (input: RequestInfo | URL) => {
    const reply = answer(new URL(String(input)).searchParams.get('type')!);
    return reply instanceof Response ? reply : Response.json(reply);
  }) as typeof fetch);

const ok = (...answers: { type: number; data: string }[]) => ({ Status: 0, Answer: answers });
const A = (data: string) => ({ type: 1, data });
const AAAA = (data: string) => ({ type: 28, data });

describe('refused destinations', () => {
  it('refuses a host that resolves to a private address, without naming the address', async () => {
    const s = await setup();
    const sneaky = recorder();
    s.receivers['sneaky.example.org'] = sneaky.handler;
    const res = await subscribeRaw(s, { url: 'https://sneaky.example.org/in' });
    expect(res.status).toBe(422);
    const body = await problem(res);
    expect(body.code).toBe('destination_refused');
    expect(body.detail).toContain('non-public');
    expect(JSON.stringify(body)).not.toContain('10.0.0.5');
    expect(sneaky.requests).toHaveLength(0);
    expect(await one(s, 'SELECT COUNT(*) AS n FROM subscriptions')).toEqual({ n: 0 });
  });

  it('refuses a host that hides a private IPv6 address next to a public IPv4 one', async () => {
    const s = await setup();
    s.dns['dual.orrery.dev'] = ['93.184.216.34', 'fd00::5'];
    const res = await subscribeRaw(s, { url: 'https://dual.orrery.dev/in' });
    expect(res.status).toBe(422);
    expect(JSON.stringify(await res.json())).not.toContain('fd00');
  });

  it('refuses the relay’s own hosts and workers.dev with its subdomains', async () => {
    const s = await setup();
    expect(s.relay.config.blockedHosts).toEqual(expect.arrayContaining(['workers.dev']));
    for (const url of [
      'https://my-agent.workers.dev/hook',
      'https://a.b.workers.dev/hook',
      'https://workers.dev/hook',
      'https://logitland.test/hook',
      'https://relay.logitland.test/hook',
    ]) {
      const res = await subscribeRaw(s, { url });
      expect(res.status, url).toBe(422);
      expect((await problem(res)).code).toBe('destination_refused');
    }
  });

  it('refuses hosts that don’t resolve, and plain HTTP', async () => {
    const s = await setup();
    const missing = await subscribeRaw(s, { url: 'https://nowhere.orrery.dev/in' });
    expect(missing.status).toBe(422);
    expect((await problem(missing)).detail).toContain('doesn’t resolve');
    expect((await subscribeRaw(s, { url: 'http://hooks.orrery.dev/in' as `https://${string}` })).status).toBe(400);
  });

  it('refuses when the DNS lookup itself fails', async () => {
    const s = await setup();
    s.relay.resolver = doh((type) => (type === 'AAAA' ? { Status: 2 } : ok(A('93.184.216.34'))));
    s.receivers[HOOK_HOST] = recorder().handler;
    const res = await subscribeRaw(s);
    expect(res.status).toBe(422);
    expect((await problem(res)).detail).toContain('looked up');
    expect(await one(s, 'SELECT COUNT(*) AS n FROM subscriptions')).toEqual({ n: 0 });
  });
});

describe('the DoH resolver', () => {
  it('merges A and AAAA answers and ignores other record types', async () => {
    const resolver = doh((type) => (type === 'A' ? ok({ type: 5, data: 'edge.example.net.' }, A('93.184.216.34')) : ok(AAAA('2606:4700:4700::1111'))));
    await expect(resolver.resolve('hooks.orrery.dev')).resolves.toEqual(['93.184.216.34', '2606:4700:4700::1111']);
  });

  it('treats NXDOMAIN as no addresses', async () => {
    const resolver = doh(() => ({ Status: 3 }));
    await expect(resolver.resolve('nowhere.orrery.dev')).resolves.toEqual([]);
    await expect(preflightDestination('https://nowhere.orrery.dev/', resolver)).rejects.toThrow('doesn’t resolve');
  });

  it.each([
    ['SERVFAIL on AAAA', (type: string) => (type === 'AAAA' ? { Status: 2 } : ok(A('93.184.216.34')))],
    ['SERVFAIL on A', (type: string) => (type === 'A' ? { Status: 2 } : ok(AAAA('2606:4700:4700::1111')))],
    ['REFUSED', () => ({ Status: 5 })],
    ['a missing Status', () => ({ Answer: [A('93.184.216.34')] })],
    ['an HTTP error', () => new Response('bad gateway', { status: 502 })],
    ['a body that isn’t JSON', () => new Response('<html>')],
  ])('fails the whole lookup on %s', async (_name, answer) => {
    await expect(doh(answer).resolve('hooks.orrery.dev')).rejects.toBeInstanceOf(DestinationRefused);
  });

  it('fails when the request itself fails', async () => {
    const resolver = dohResolver((async () => {
      throw new TypeError('network down');
    }) as typeof fetch);
    await expect(resolver.resolve('hooks.orrery.dev')).rejects.toThrow('looked up');
  });
});

describe('destination checks', () => {
  it('never echoes the resolved address', async () => {
    for (const address of ['10.0.0.5', '169.254.169.254', 'fd00::1', '::1']) {
      const resolver: Resolver = { resolve: async () => ['93.184.216.34', address] };
      const err = await preflightDestination('https://hooks.orrery.dev/', resolver).catch((e: Error) => e);
      expect(err).toBeInstanceOf(DestinationRefused);
      expect((err as Error).message).toBe('The hostname resolves to a non-public address');
    }
  });

  it('compares blocked hosts case-insensitively, including subdomains', () => {
    expect(() => checkUrl('https://api.logitland.org/x', ['Logitland.ORG'])).toThrow('belongs to Logitland');
    expect(() => checkUrl('https://deep.sub.workers.dev/x', ['workers.dev'])).toThrow('belongs to Logitland');
    expect(() => checkUrl('https://workers.dev/x', ['WORKERS.DEV'])).toThrow('belongs to Logitland');
    expect(() => checkUrl('https://api.workers.dev./x', ['workers.dev'])).toThrow('belongs to Logitland');
    expect(() => checkUrl('https://notworkers.dev/x', ['workers.dev'])).not.toThrow();
  });

  it('normalises a trailing dot so one host has one spelling', () => {
    expect(checkUrl('https://hooks.orrery.dev./x').hostname).toBe('hooks.orrery.dev');
  });

  it('keeps the existing URL and address rules', () => {
    for (const u of [
      'http://hooks.orrery.dev',
      'https://user:pw@hooks.orrery.dev',
      'https://hooks.orrery.dev:22',
      'https://10.0.0.1',
      'https://[::1]/',
      'https://localhost',
      'https://box.internal',
    ]) {
      expect(() => checkUrl(u), u).toThrow(DestinationRefused);
    }
    for (const a of ['93.184.216.34', '2606:4700:4700::1111', '::ffff:93.184.216.34']) expect(isPublicAddress(a), a).toBe(true);
    for (const a of [
      '10.1.2.3',
      '127.0.0.1',
      '169.254.169.254',
      '100.64.0.1',
      '::1',
      'fe80::1',
      'fd00::1',
      '::ffff:127.0.0.1',
      '64:ff9b::a00:1',
      '2002:a00:1::',
      'not-an-ip',
    ])
      expect(isPublicAddress(a), a).toBe(false);
  });
});
