import { SecretBox } from '@logitland/relay';
import { SqliteD1 } from '@logitland/relay/testing';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import worker, { InternalApi, type Bindings } from './index';

const migrations = fileURLToPath(new URL('../../../packages/relay/migrations', import.meta.url).href);
const ns = { idFromName: () => ({}), get: () => ({}) } as unknown as Bindings['GATEWAY'];

function env(over: Partial<Bindings> = {}): Bindings {
  return {
    DB: new SqliteD1().migrate(migrations) as unknown as D1Database,
    RELAY_SECRET_KEY: SecretBox.generateKey(),
    INTERNAL_TOKEN: 'test-internal-token',
    PUBLIC_URL: 'https://relay.logitland.test',
    DASHBOARD_URL: 'https://logitland.test',
    RELAY_MODE: 'development',
    GATEWAY: ns,
    CHANNEL_SENDER: ns as unknown as Bindings['CHANNEL_SENDER'],
    AGENT_STREAM: ns as unknown as Bindings['AGENT_STREAM'],
    ...over,
  };
}

const ctx = { waitUntil: vi.fn(), passThroughOnException: vi.fn(), props: {} } as unknown as ExecutionContext;

describe('backend worker', () => {
  it('serves auth.md on the public entrypoint', async () => {
    const md = await worker.fetch(new Request('https://relay.logitland.test/auth.md'), env(), ctx);
    expect(md.status).toBe(200);
    expect(await md.text()).toContain('# auth.md');
  });

  it('never serves the dashboard API on the public entrypoint', async () => {
    const e = env();
    const res = await worker.fetch(
      new Request('https://relay.logitland.test/internal/owners', {
        method: 'POST',
        headers: { 'x-logitland-internal': 'test-internal-token', 'content-type': 'application/json' },
        body: '{}',
      }),
      e,
      ctx,
    );
    expect(res.status).toBe(404);
  });

  it('serves the dashboard API on InternalApi, behind the token', async () => {
    const e = env();
    const api = new InternalApi(ctx as never, e);
    const denied = await api.fetch(new Request('https://relay.internal/internal/admin/audit', { headers: { 'x-logitland-owner': 'own_01JB7Q2M8R' } }));
    expect(denied.status).toBe(401);
  });

  it('answers 503 and names nothing secret when production settings are missing', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = await worker.fetch(new Request('https://relay.example.org/'), env({ RELAY_MODE: undefined, PUBLIC_URL: 'https://relay.example.org' }), ctx);
    expect(res.status).toBe(503);
    expect(((await res.json()) as { code: string }).code).toBe('misconfigured');
    const logged = String(spy.mock.calls[0]?.[0]);
    expect(logged).toContain('DISCORD_BOT_TOKEN is missing');
    expect(logged).not.toContain('test-internal-token');
    spy.mockRestore();
  });

  it('refuses development mode on a public hostname', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = await worker.fetch(new Request('https://relay.logitland.org/'), env({ PUBLIC_URL: 'https://relay.logitland.org' }), ctx);
    expect(res.status).toBe(503);
    expect(String(spy.mock.calls[0]?.[0])).toContain('RELAY_MODE=development is only allowed on a local PUBLIC_URL');
    spy.mockRestore();
  });

  it('runs the cron jobs and isolates failures', async () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    await worker.scheduled({ cron: '* * * * *', scheduledTime: Date.now() } as ScheduledController, env(), ctx);
    expect(spy.mock.calls.some((c) => String(c[0]).includes('cron.done'))).toBe(true);
    spy.mockRestore();
  });
});
