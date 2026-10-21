import { checkConfig, SecretBox, type RelayBindings } from '@logitland/relay';
import { afterAll, describe, expect, it } from 'vitest';
import { E2E, eventually, startStack, type Stack } from './harness.ts';

// (a) The startup checks fail closed, on the real runtime: a Worker that is told to talk to a fake Discord without being
// in development mode answers 503 everywhere instead of running half-protected.
describe.skipIf(!E2E)('startup checks', () => {
  const stacks: Stack[] = [];
  afterAll(() => Promise.all(stacks.map((s) => s.dispose())));

  it('checkConfig refuses DISCORD_API_BASE without development mode', () => {
    const env = {
      DB: {},
      RELAY_SECRET_KEY: SecretBox.generateKey(),
      INTERNAL_TOKEN: 'x'.repeat(40),
      IP_HASH_KEY: 'h'.repeat(40),
      PUBLIC_URL: 'https://relay.logitland.test',
      DASHBOARD_URL: 'https://logitland.test',
      DISCORD_API_BASE: 'http://127.0.0.1:9/api/v10',
    } as unknown as RelayBindings;
    expect(checkConfig(env)).toContain('DISCORD_API_BASE is only allowed in development');
    expect(checkConfig({ ...env, RELAY_MODE: 'development', PUBLIC_URL: 'http://localhost:8787', DASHBOARD_URL: 'http://localhost:5173' })).toEqual([]);
    expect(checkConfig({ ...env, RELAY_MODE: 'development', PUBLIC_URL: 'https://relay.logitland.dev' })).toContain(
      'RELAY_MODE=development is only allowed on a local PUBLIC_URL',
    );
  });

  it('the Worker answers 503 on every public route when DISCORD_API_BASE is set outside development', async () => {
    const s = await startStack({ env: { RELAY_MODE: '' }, channels: false });
    stacks.push(s);
    for (const [method, path] of [
      ['GET', '/'],
      ['GET', '/rules.md'],
      ['GET', '/v1/signup/challenge'],
      ['GET', '/public/channels'],
      ['POST', '/discord/interactions'],
    ] as const) {
      const res = await s.call(method, path);
      expect(res.status, `${method} ${path}`).toBe(503);
      expect(res.body).toMatchObject({ status: 503, code: 'misconfigured', title: 'The relay is not configured correctly' });
    }
    // The problems are logged by name, never answered, and the fake Discord was never contacted.
    await eventually(() => s.logs.some((l) => l.includes('DISCORD_API_BASE is only allowed in development')), { what: 'the config problem in the Worker log' });
    expect(JSON.stringify((await s.call('GET', '/')).body)).not.toContain('DISCORD_API_BASE');
    expect(s.fake.requests).toHaveLength(0);
    expect(s.outbound.blocked).toEqual([]);
  });

  it('development mode is refused on a public URL, even with the fake', async () => {
    const s = await startStack({ env: { PUBLIC_URL: 'https://relay.logitland.dev' }, channels: false });
    stacks.push(s);
    expect((await s.call('GET', '/')).status).toBe(503);
    await eventually(() => s.logs.some((l) => l.includes('RELAY_MODE=development is only allowed on a local PUBLIC_URL')), {
      what: 'the config problem in the Worker log',
    });
  });
});
