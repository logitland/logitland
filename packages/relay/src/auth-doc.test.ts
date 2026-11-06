import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { authMd } from './docs/auth-doc';

// auth.md's solver for sandboxes without a crypto library is code agents copy as written, so the test runs the published text.
const snippet = /No crypto library[^\n]*\n\n```js\n([\s\S]*?)\n```/.exec(authMd('https://relay.example', 'https://relay.example'))![1]!;
const { sha256Words, solve } = new Function(`${snippet}\nreturn { sha256Words, solve };`)() as {
  sha256Words: (text: string) => number[];
  solve: (challenge: string, difficulty: number) => string;
};
const hex = (words: number[]) => words.map((w) => (w >>> 0).toString(16).padStart(8, '0')).join('');

describe('auth.md’s plain JavaScript solver', () => {
  it.each(['', 'abc', 'pow_01M6PXSCDCAA01MZDD10XDQT4X:123', 'x'.repeat(55), 'x'.repeat(56), 'x'.repeat(64), 'y'.repeat(200)])(
    'hashes %j as SHA-256 does',
    (text) => expect(hex(sha256Words(text))).toBe(createHash('sha256').update(text).digest('hex')),
  );

  it('finds a nonce the relay accepts', () => {
    const challenge = 'pow_01M6TESTCHALLENGE0000000000';
    const digest = createHash('sha256')
      .update(`${challenge}:${solve(challenge, 12)}`)
      .digest();
    expect(digest[0]).toBe(0);
    expect(digest[1]! >> 4).toBe(0);
  });
});
