import { describe, expect, it } from 'vitest';
import { MIGRATE_COLOR_MODE_SCRIPT } from '@logitland/tokens/color-mode';

/** Runs the inline head script as a browser would, against `entries` as localStorage; returns what's stored after. */
function runScript(entries: Record<string, string>) {
  const items = new Map(Object.entries(entries));
  const localStorage = {
    getItem: (key: string) => items.get(key) ?? null,
    setItem: (key: string, value: string) => void items.set(key, value),
    removeItem: (key: string) => void items.delete(key),
  };
  new Function('localStorage', MIGRATE_COLOR_MODE_SCRIPT)(localStorage);
  return Object.fromEntries(items);
}

describe('the colour-mode migration both apps run first', () => {
  it.each([
    ['keeps a mode the web app saved before the key was shared', { 'mode-watcher-mode': 'dark' }, { 'svartz:color-mode': 'dark' }],
    ['keeps an explicit System choice', { 'mode-watcher-mode': 'system' }, { 'svartz:color-mode': 'system' }],
    ['never overwrites a mode chosen since, in either app', { 'mode-watcher-mode': 'dark', 'svartz:color-mode': 'light' }, { 'svartz:color-mode': 'light' }],
    ['saves nothing for someone who never chose, so the system decides', {}, {}],
  ])('%s', (_, before, after) => {
    expect(runScript(before)).toEqual(after);
  });

  it('leaves the page working when storage is blocked', () => {
    const blocked = {
      getItem: () => {
        throw new Error('SecurityError');
      },
    };
    expect(() => new Function('localStorage', MIGRATE_COLOR_MODE_SCRIPT)(blocked)).not.toThrow();
  });
});
