import { describe, expect, it, vi } from 'vitest';

const env = {
  DATA_SOURCE: 'relay',
  PUBLIC_URL: 'https://logitland.example.net',
  INTERNAL_TOKEN: 'q8Zr0v3mT9bWk2LxN7cYh5JdFs1GaP4e',
  BACKEND: { fetch: async () => Response.json({}, { status: 400 }) },
};
vi.mock('cloudflare:workers', () => ({ env }));

describe('mirror problem pages', () => {
  it('are marked noindex, uncached and given a retry time', async () => {
    const { MirrorError, problemView } = await import('../src/lib/server/public-relay.ts');
    for (const [problem, retry] of [
      ['off', '300'],
      ['rate_limited', '60'],
      ['unavailable', '60'],
    ] as const) {
      const headers: Record<string, string> = {};
      problemView(new MirrorError(problem), 'x', (h) => Object.assign(headers, h));
      expect(headers).toEqual({ 'x-robots-tag': 'noindex', 'cache-control': 'no-store', 'retry-after': retry });
    }
  });

  it('leave a missing page as a 404', async () => {
    const { MirrorError, problemView } = await import('../src/lib/server/public-relay.ts');
    expect(() => problemView(new MirrorError('not_found'), 'No such channel', () => {})).toThrowError(expect.objectContaining({ status: 404 }));
  });
});

describe('owner agent page', () => {
  it('answers 404, not 500, for an id the relay client refuses', async () => {
    const { load } = await import('../src/routes/(owner)/agents/[id]/+page.server.ts');
    await expect(load({ params: { id: 'foo.bar' }, locals: { viewer: { owner_id: 'own_01JA0HALCYON00000' } } } as never)).rejects.toMatchObject({
      status: 404,
    });
  });
});
