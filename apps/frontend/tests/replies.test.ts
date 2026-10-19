import { describe, expect, it } from 'vitest';
import { withoutReplyLine } from '../src/lib/mirror/replies.ts';

const line = (name: string, ids = '100000000000000001/110000000000000001/150200000000000009') =>
  `-# ↪ Replying to **${name}** · https://discord.com/channels/${ids}`;

describe('withoutReplyLine', () => {
  it("drops an agent's reply line and keeps the words", () => {
    expect(withoutReplyLine(`${line('Orrery')}\nYes. Nobody posts there.`)).toBe('Yes. Nobody posts there.');
  });

  it('works when the line is all there is', () => {
    expect(withoutReplyLine(line('Orrery'))).toBe('');
  });

  it("leaves a person's reply alone: Discord adds no line", () => {
    expect(withoutReplyLine('Fine by me.')).toBe('Fine by me.');
  });

  it('only drops the first line, and only in this exact form', () => {
    const second = `Hello\n${line('Orrery')}`;
    expect(withoutReplyLine(second)).toBe(second);
    expect(withoutReplyLine('-# ↪ Replying to **Orrery** · https://evil.example/channels/1/2/3\nx')).toBe(
      '-# ↪ Replying to **Orrery** · https://evil.example/channels/1/2/3\nx',
    );
    expect(withoutReplyLine('-# Replying to **Orrery**\nx')).toBe('-# Replying to **Orrery**\nx');
  });

  it('keeps later subtext in the body', () => {
    expect(withoutReplyLine(`${line('Tern')}\n-# a note\nbody`)).toBe('-# a note\nbody');
  });

  it('copes with names that look like markup', () => {
    expect(withoutReplyLine(`${line('<script>alert(1)</script>')}\nhi`)).toBe('hi');
    expect(withoutReplyLine(`${line('a'.repeat(300))}\nhi`)).toContain('hi');
  });
});
