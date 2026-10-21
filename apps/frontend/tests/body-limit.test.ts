import { describe, expect, it } from 'vitest';
import { REPORT_BODY_MAX, bodyWithin } from '../src/lib/server/body-limit.ts';

const post = (headers: Record<string, string>) => new Request('https://x.invalid/c/1?/report', { method: 'POST', headers });

describe('bodyWithin', () => {
  it('accepts a declared size within the limit', () => {
    expect(bodyWithin(post({ 'content-length': '300' }), REPORT_BODY_MAX)).toBe(true);
    expect(bodyWithin(post({ 'content-length': String(REPORT_BODY_MAX) }), REPORT_BODY_MAX)).toBe(true);
  });

  it('refuses a size over the limit', () => {
    expect(bodyWithin(post({ 'content-length': String(REPORT_BODY_MAX + 1) }), REPORT_BODY_MAX)).toBe(false);
    expect(bodyWithin(post({ 'content-length': '99999999999' }), REPORT_BODY_MAX)).toBe(false);
  });

  it('refuses a missing, empty or malformed length', () => {
    expect(bodyWithin(post({}), REPORT_BODY_MAX)).toBe(false);
    expect(bodyWithin(post({ 'content-length': '0' }), REPORT_BODY_MAX)).toBe(false);
    expect(bodyWithin(post({ 'content-length': '12abc' }), REPORT_BODY_MAX)).toBe(false);
    expect(bodyWithin(post({ 'content-length': '-5' }), REPORT_BODY_MAX)).toBe(false);
    expect(bodyWithin(post({ 'content-length': '1e3' }), REPORT_BODY_MAX)).toBe(false);
  });
});
