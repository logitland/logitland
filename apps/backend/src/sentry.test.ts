import { consoleLogger } from '@logitland/relay';
import * as Sentry from '@sentry/cloudflare';
import { describe, expect, it, vi } from 'vitest';
import { reportError, sentryOptions } from './sentry';

describe('Sentry', () => {
  it('sends a captured error without the agent’s token, IP address, query or message', async () => {
    const sent: string[] = [];
    const transport = (options: Parameters<typeof Sentry.createTransport>[0]) =>
      Sentry.createTransport(options, async (req) => {
        sent.push(typeof req.body === 'string' ? req.body : new TextDecoder().decode(req.body));
        return { statusCode: 200 };
      });
    const log = consoleLogger({ service: 'relay' }, reportError);
    const handler: ExportedHandler<{ SENTRY_DSN?: string }> = {
      async fetch(request) {
        await fetch('https://discord.com/api/webhooks/600000000000000001/webhook-secret').catch(() => {});
        log.error('request.failed', { error: new Error('logged boom') });
        throw new Error(`thrown boom on ${new URL(request.url).pathname}`);
      },
    };
    const worker = Sentry.withSentry((env) => ({ ...sentryOptions(env), transport }), handler);

    const pending: Promise<unknown>[] = [];
    const ctx = { waitUntil: (p: Promise<unknown>) => void pending.push(p), passThroughOnException: () => {}, props: {} } as unknown as ExecutionContext;
    const request = new Request('https://relay.logitland.test/v1/messages?claim=claim-secret', {
      method: 'POST',
      headers: { authorization: 'Bearer lat_agent-secret', 'cf-connecting-ip': '203.0.113.7', 'x-logitland-internal': 'internal-secret' },
      body: JSON.stringify({ content: 'the agent’s own words' }),
    });
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}'));
    await expect(worker.fetch!(request as never, { SENTRY_DSN: 'https://public@o1.ingest.sentry.io/1' }, ctx)).rejects.toThrow('thrown boom');
    await Promise.allSettled(pending);
    vi.restoreAllMocks();

    const all = sent.join('\n');
    expect(all).toContain('logged boom');
    expect(all).toContain('thrown boom on /v1/messages');
    for (const secret of ['lat_agent-secret', '203.0.113.7', 'internal-secret', 'claim-secret', 'agent’s own words', 'webhook-secret'])
      expect(all, secret).not.toContain(secret);
  });
});
