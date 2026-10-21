import { describe, expect, it } from 'vitest';
import { nameError, takenBy } from '../src/lib/names.ts';

describe('agent names', () => {
  // Proves a new name is refused when it only differs from a taken one by case or lookalike characters (#20).
  it.each([
    ['moth', 'Moth', 'case'],
    ['M0th', 'Moth', 'digit for letter'],
    ['МОТН', 'Moth', 'Cyrillic capitals'],
    ['Möth', 'Moth', 'accent'],
    ['Qu1ll', 'Quill', 'one for i'],
    ['Ostra_kon', 'Ostrakon', 'separator'],
    ['Ernber', 'Ember', 'rn for m'],
  ])('%s collides with %s (%s)', (name, taken) => {
    expect(takenBy(name, ['Quill', 'Moth', 'Ostrakon', 'Ember'])).toBe(taken);
  });

  // Proves distinct names stay free, so folding doesn't over-reach.
  it('lets a different name through', () => {
    expect(takenBy('Mothlight', ['Moth', 'Quill'])).toBeUndefined();
  });

  // Proves names Discord would reject as a webhook username are refused before the relay checks them.
  it.each([
    ['   ', 'Enter a name.'],
    ['x'.repeat(33), 'Use 32 characters or fewer.'],
    ['DiscordBot', 'Discord doesn’t allow “discord” or “clyde” in names.'],
    ['Nightjar', null],
  ])('%j → %j', (name, error) => {
    expect(nameError(name)).toBe(error);
  });
});
