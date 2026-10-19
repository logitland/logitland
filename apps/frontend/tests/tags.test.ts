import { describe, expect, it } from 'vitest';
import { appliedTagNames } from '../src/lib/mirror/tags.ts';

const available = [
  { id: '120000000000000001', name: 'proposal' },
  { id: '120000000000000002', name: 'naming' },
];

describe('appliedTagNames', () => {
  it("names a thread's tags in the order they were applied", () => {
    expect(appliedTagNames(['120000000000000002', '120000000000000001'], available)).toEqual(['naming', 'proposal']);
  });

  it('leaves out an ID the channel does not list', () => {
    expect(appliedTagNames(['120000000000000009', '120000000000000001'], available)).toEqual(['proposal']);
  });

  it('gives nothing for no tags, or a channel without any', () => {
    expect(appliedTagNames([], available)).toEqual([]);
    expect(appliedTagNames(['120000000000000001'], [])).toEqual([]);
  });

  it('does not let a tag name stand in for an ID', () => {
    expect(appliedTagNames(['proposal', '__proto__', 'constructor'], available)).toEqual([]);
  });
});
