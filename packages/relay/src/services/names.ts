import type { PolicyCode } from '@logitland/contracts';
import { evaluateRules, judge } from './moderation/rules';

// Agent name policy and the folded key that makes names unique. Names also pass the fixed message rules (invites,
// credentials, blocked sites, personal details, spam), so a name can't say what a message can't.

export type PolicyResult = { ok: true } | { ok: false; code: PolicyCode; reason: string };

/** Characters that look like a Latin letter, by the letter they imitate. `i` and `l` share one letter: 1, | and I all pass for either. */
const LOOKALIKES: Record<string, string> = {
  a: '4@аα',
  b: '8вβ',
  c: 'сϲ',
  d: 'ԁđð',
  e: '3еε',
  g: 'ɡ',
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

/** Greek capitals that look like a Latin capital. Lower-casing first would turn them into letters that look like something else (Ν into ν, a v). */
const GREEK_CAPITALS = new Map(
  Object.entries({ Α: 'a', Β: 'b', Ε: 'e', Ζ: 'z', Η: 'h', Ι: 'i', Κ: 'k', Μ: 'm', Ν: 'n', Ο: 'o', Ρ: 'p', Τ: 't', Υ: 'y', Χ: 'x' }),
);

/**
 * The key two names collide on: compatibility-normalised, lower-cased, stripped of Latin diacritics,
 * with lookalike digits, symbols and Cyrillic/Greek letters folded to Latin, separators dropped, and `rn` and `vv` read as `m` and `w`.
 * `Adm1n`, `Аdmin` (Cyrillic А) and `a.d.m.i.n` all share the key `admln`.
 */
export function nameKey(name: string): string {
  const plain = [...name.normalize('NFKC')]
    .map((ch) => GREEK_CAPITALS.get(ch) ?? ch)
    .join('')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u{300}-\u{36f}]/gu, '')
    .normalize('NFC');
  return [...plain]
    .map((ch) => FOLD.get(ch) ?? ch)
    .join('')
    .replace(SEPARATORS, '')
    .replace(/rn/g, 'm')
    .replace(/vv/g, 'w');
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
  'moderation',
  'trustandsafety',
  'mirrorbot',
];
/** Too common inside ordinary words (model, anywhere), so only reserved as a whole name or a whole word of one. */
const RESERVED_WORDS = ['mod', 'mods', 'here', 'automod', 'modteam', 'modmail', 'verified'];

const RESERVED_KEYS = RESERVED.map((w) => [w, nameKey(w)] as const);
const RESERVED_WORD_KEYS = RESERVED_WORDS.map((w) => [w, nameKey(w)] as const);

const INVISIBLE = /[\p{Cc}\p{Cf}\p{Default_Ignorable_Code_Point}\p{Variation_Selector}\u{2028}\u{2029}]/u;
const ALLOWED = /^[\p{L}\p{M}\p{Nd} _.'-]+$/u;

const refuse = (code: PolicyCode, reason: string): PolicyResult => ({ ok: false, code, reason });

/** What each fixed rule found, worded for a name. Never repeats the text that matched. */
const FOUND: Partial<Record<PolicyCode, string>> = {
  invite_link: 'contains a Discord invite',
  secret_leak: 'appears to contain a credential, which you should treat as exposed and rotate or revoke',
  blocked_domain: 'links to a site that isn’t allowed here',
  personal_info: 'includes an email address or phone number, and names are public',
  spam: 'looks like spam',
  control_chars: 'contains invisible or direction-changing characters',
};

/**
 * The fixed message rules, run over a name. Holds count as refusals: there is no review queue for names.
 * The sentence says what was found and that nothing was saved; the message wording ("not posted") doesn't fit a name.
 */
function fixedRules(name: string): PolicyResult {
  const ruling = judge(evaluateRules({ content: name }, { links: true }));
  if (ruling.verdict === 'pass') return { ok: true };
  const policy = ruling.policy!;
  return refuse(policy, `The name ${FOUND[policy] ?? 'breaks the rules'}, so it wasn’t saved. Pick a different name.`);
}

/** An avatar address may not point at a site the message rules block (link shorteners, IP loggers, fake gift pages). */
export function checkAvatarUrl(url: string): PolicyResult {
  if (evaluateRules({ content: url }, { links: true }).some((m) => m.policy === 'blocked_domain')) {
    return refuse('blocked_domain', 'The avatar address points at a site that isn’t allowed here. Use another image address.');
  }
  return { ok: true };
}

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
  if (/\p{Script=Latin}/u.test(name) && /[\p{Script=Greek}\p{Script=Cyrillic}]/u.test(name)) {
    return refuse('name_policy', 'Names can’t mix Latin letters with Greek or Cyrillic ones, which can pass for each other. Use one alphabet.');
  }
  return fixedRules(name);
}
