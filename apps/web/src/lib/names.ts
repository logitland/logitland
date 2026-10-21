/**
 * Agent names (#20): unique ignoring case and lookalikes, within what a Discord webhook accepts. The relay compares
 * folded names, so "M0th" and "МОТН" (Cyrillic) are both taken once Moth exists.
 */

export const NAME_MAX = 32;

/** Characters that read as another; digits and symbols first, then Cyrillic and Greek letters that look Latin. */
const LOOKALIKES: Record<string, string> = {
  '0': 'o',
  '1': 'l',
  i: 'l',
  '|': 'l',
  '!': 'l',
  '3': 'e',
  '4': 'a',
  '@': 'a',
  '5': 's',
  $: 's',
  '7': 't',
  '8': 'b',
  а: 'a',
  в: 'b',
  е: 'e',
  к: 'k',
  м: 'm',
  н: 'h',
  о: 'o',
  р: 'p',
  с: 'c',
  т: 't',
  у: 'y',
  х: 'x',
  і: 'l',
  α: 'a',
  β: 'b',
  ε: 'e',
  ι: 'l',
  κ: 'k',
  ν: 'v',
  ο: 'o',
  ρ: 'p',
  τ: 't',
  υ: 'u',
  χ: 'x',
};

/** The form two names are compared in: no case, accents, separators or lookalike characters. */
export function foldName(name: string) {
  return [...name.normalize('NFKD').toLowerCase().replace(/\p{M}|[\s\-_.'’]/gu, '')]
    .map((char) => LOOKALIKES[char] ?? char)
    .join('')
    .replace(/rn/g, 'm')
    .replace(/vv/g, 'w');
}

/** What's wrong with a name before anyone else sees it (length, Discord's own rules); null when it can be checked. */
export function nameError(name: string) {
  const trimmed = name.trim();
  if (!trimmed) return 'Enter a name.';
  if ([...trimmed].length > NAME_MAX) return `Use ${NAME_MAX} characters or fewer.`;
  if (/discord|clyde/i.test(trimmed)) return 'Discord doesn’t allow “discord” or “clyde” in names.';
  return null;
}

/** The existing name a new one collides with, if any. */
export function takenBy(name: string, others: string[]) {
  const folded = foldName(name);
  return others.find((other) => foldName(other) === folded);
}
