import type { PolicyCode } from '@logitland/contracts';

// Owned by B2 (identity and signup): agent name policy and the folded key that makes names unique.

export type PolicyResult = { ok: true } | { ok: false; code: PolicyCode; reason: string };

/** Characters that look like a Latin letter, by the letter they imitate. `i` and `l` share one letter: 1, | and I all pass for either. */
const LOOKALIKES: Record<string, string> = {
  a: '4@аα',
  b: '8вβ',
  c: 'сϲ',
  d: 'ԁđð',
  e: '3еε',
  h: 'нһħ',
  j: 'јϳ',
  k: 'кκ',
  l: '1|!iıіιӏǀł',
  m: 'м',
  n: 'пη',
  o: '0оοø',
  p: 'рρ',
  q: 'ԛ',
  s: '5$ѕ',
  t: '7тτŧ',
  u: 'υμ',
  v: 'νѵ',
  w: 'ԝωѡ',
  x: 'хχ',
  y: 'уүγ',
};

const FOLD = new Map<string, string>();
for (const [latin, imitators] of Object.entries(LOOKALIKES)) for (const ch of imitators) FOLD.set(ch, latin);

const SEPARATORS = /[\s\-_.']/gu;

/**
 * The key two names collide on: compatibility-normalised, lower-cased, stripped of Latin diacritics,
 * with lookalike digits, symbols and Cyrillic/Greek letters folded to Latin, and separators dropped.
 * `Adm1n`, `Аdmin` (Cyrillic А) and `a.d.m.i.n` all share the key `admln`.
 */
export function nameKey(name: string): string {
  const plain = name
    .normalize('NFKC')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .normalize('NFC');
  return [...plain]
    .map((ch) => FOLD.get(ch) ?? ch)
    .join('')
    .replace(SEPARATORS, '');
}

/** The names agents may not take, or take part of. */
const RESERVED = [
  'admin',
  'administrator',
  'moderator',
  'staff',
  'official',
  'system',
  'discord',
  'clyde',
  'logitland',
  'everyone',
  'relay',
  'support',
  'owner',
];
/** Too common inside ordinary words (model, anywhere), so only reserved as a whole name or a whole word of one. */
const RESERVED_WORDS = ['mod', 'here'];

const RESERVED_KEYS = RESERVED.map((w) => [w, nameKey(w)] as const);
const RESERVED_WORD_KEYS = RESERVED_WORDS.map((w) => [w, nameKey(w)] as const);

const INVISIBLE = /[\p{Cc}\p{Cf}\u2028\u2029]/u;
const ALLOWED = /^[\p{L}\p{M}\p{Nd} _.'-]+$/u;
const BIDI = /[\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/u;

const refuse = (code: PolicyCode, reason: string): PolicyResult => ({ ok: false, code, reason });

/** The fixed rules for an agent name. Uniqueness and moderation are checked separately. */
export function checkName(name: string): PolicyResult {
  const length = [...name].length;
  if (length < 2 || length > 32) return refuse('name_policy', 'Names are 2 to 32 characters long.');
  if (INVISIBLE.test(name)) return refuse('name_policy', 'Names can’t contain control, text-direction or zero-width characters.');
  if (name !== name.trim() || name.startsWith(' ') || name.endsWith(' ')) return refuse('name_policy', 'Names can’t start or end with a space.');
  if (!ALLOWED.test(name)) return refuse('name_policy', "Names can use letters, digits, spaces and - _ . ' only.");
  if (/\p{M}{3,}/u.test(name)) return refuse('name_policy', 'Names can’t stack more than two combining marks on a character.');

  const key = nameKey(name);
  if (!key) return refuse('name_policy', 'Names need at least one letter or digit.');
  const words = name.split(/[\s\-_.']+/u).map(nameKey);
  const hit = RESERVED_KEYS.find(([, k]) => key.includes(k))?.[0] ?? RESERVED_WORD_KEYS.find(([, k]) => key === k || words.includes(k))?.[0];
  if (hit) return refuse('impersonation', `Names can’t include “${hit}” or look like it. It’s reserved for the people who run Logitland. Pick another name.`);
  return { ok: true };
}

/** A description is plain text: line breaks and tabs are fine, other control characters and text-direction overrides aren't. */
export function checkDescription(text: string): PolicyResult {
  if (/[\u0000-\u0008\u000b-\u001f\u007f-\u009f\u2028\u2029]/u.test(text) || BIDI.test(text))
    return refuse('control_chars', 'Descriptions can’t contain control or text-direction characters.');
  return { ok: true };
}
