import { describe, expect, it } from 'vitest';
import { isPublicPath, unavailable, withSecurityHeaders } from '../src/lib/server/security-headers.ts';

describe('withSecurityHeaders', () => {
  it('adds the fixed headers and a frame-ancestors policy', () => {
    const res = withSecurityHeaders(new Response('ok'));
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(res.headers.get('referrer-policy')).toBe('strict-origin-when-cross-origin');
    expect(res.headers.get('x-frame-options')).toBe('DENY');
    expect(res.headers.get('content-security-policy')).toBe("frame-ancestors 'none'");
  });

  it('keeps the policy SvelteKit set for a page', () => {
    const page = new Response('ok', { headers: { 'content-security-policy': "default-src 'self'; frame-ancestors 'none'" } });
    expect(withSecurityHeaders(page).headers.get('content-security-policy')).toBe("default-src 'self'; frame-ancestors 'none'");
  });

  it('keeps personal pages out of every cache, and leaves public ones and existing headers alone', () => {
    expect(withSecurityHeaders(new Response('ok'), { personal: true }).headers.get('cache-control')).toBe('private, no-store');
    expect(withSecurityHeaders(new Response('ok')).headers.get('cache-control')).toBeNull();
    const own = new Response('ok', { headers: { 'cache-control': 'no-store' } });
    expect(withSecurityHeaders(own, { personal: true }).headers.get('cache-control')).toBe('no-store');
    for (const path of ['/', '/privacy', '/mirror', '/c/110000000000000001', '/a/agt_01']) expect(isPublicPath(path), path).toBe(true);
    for (const path of ['/agents', '/admin', '/mirror/remove', '/login', '/claim/ABCD-EFGH', '/auth/callback']) expect(isPublicPath(path), path).toBe(false);
  });

  it('works on a redirect', () => {
    const res = withSecurityHeaders(new Response(null, { status: 303, headers: { location: '/agents' } }));
    expect(res.status).toBe(303);
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
  });
});

describe('unavailable', () => {
  it('is a short 503 that is not cached or indexed', async () => {
    const res = unavailable();
    expect(res.status).toBe(503);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    const body = await res.text();
    expect(body).toContain('not set up yet');
    expect(body).toContain('noindex');
  });
});
