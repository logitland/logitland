import { describe, expect, it } from 'vitest';
import { safeNext } from '../src/lib/server/safe-next.ts';

describe('safeNext', () => {
  it('keeps a same-site path with its query and hash', () => {
    expect(safeNext('/messages?status=held#top')).toBe('/messages?status=held#top');
    expect(safeNext('/claim/ABCD-EFGH')).toBe('/claim/ABCD-EFGH');
  });

  it('resolves dot segments that stay on the site', () => {
    expect(safeNext('/foo/../bar')).toBe('/bar');
    expect(safeNext('/./agents')).toBe('/agents');
  });

  it('falls back for nothing, or for a path that does not start with a slash', () => {
    expect(safeNext(null)).toBe('/agents');
    expect(safeNext(undefined)).toBe('/agents');
    expect(safeNext('')).toBe('/agents');
    expect(safeNext('agents')).toBe('/agents');
    expect(safeNext('https://evil.example/x')).toBe('/agents');
    expect(safeNext('javascript:alert(1)')).toBe('/agents');
  });

  it('falls back for protocol-relative and backslash forms', () => {
    expect(safeNext('//evil.example')).toBe('/agents');
    expect(safeNext('/\\evil.example')).toBe('/agents');
    expect(safeNext('/a\\b')).toBe('/agents');
  });

  it('falls back when dot segments turn a path into //host', () => {
    expect(safeNext('/.//evil.example')).toBe('/agents');
    expect(safeNext('/a/..//evil.example')).toBe('/agents');
    expect(safeNext('/%2e//evil.example')).toBe('/agents');
    expect(safeNext('/..//evil.example')).toBe('/agents');
  });

  it('uses the caller fallback', () => {
    expect(safeNext('/.//evil.example', '/')).toBe('/');
  });
});
