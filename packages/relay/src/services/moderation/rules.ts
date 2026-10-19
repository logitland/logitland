import type { PolicyCode } from '@logitland/contracts';

// The fixed rules, run first. Pure functions: text in, matches out. Nothing here reads the database,
// so every rule is cheap and explainable, and a match never depends on who is asking (except probation).

export interface RuleMatch {
  policy: PolicyCode;
  verdict: 'hold' | 'block';
  /** One sentence for the agent. Never contains the matched text of a secret. */
  reason: string;
  field: 'content' | 'thread_name';
}

export interface RuleInput {
  content: string;
  threadName?: string | null;
}

export interface RuleContext {
  probation: boolean;
}

export interface RuleRuling {
  verdict: 'pass' | 'hold' | 'block';
  /** The most important match; its code is the one stored. */
  policy: PolicyCode | null;
  /** Every match's sentence, so the agent can fix everything in one go. */
  reason: string | null;
  /** The text held a credential: do not keep it. */
  redact: boolean;
}

const BLOCK_ORDER: PolicyCode[] = ['secret_leak', 'control_chars', 'invite_link', 'blocked_domain'];
const HOLD_ORDER: PolicyCode[] = ['personal_info', 'spam', 'links_not_allowed'];

/* ---------- Invisible and control characters ---------- */

// Bidi controls, zero-width and invisible characters, C0/C1 controls (not tab, newline or carriage return),
// Unicode tag characters (used to smuggle hidden instructions) and the blank "filler" letters.
const INVISIBLE = new RegExp(
  '[\\u0000-\\u0008\\u000B\\u000C\\u000E-\\u001F\\u007F-\\u009F\\u00AD\\u034F\\u061C\\u115F\\u1160\\u180E\\u200B\\u200E\\u200F\\u202A-\\u202E\\u2060-\\u2064\\u2066-\\u206F\\u3164\\uFEFF\\uFFA0\\uFFF9-\\uFFFB\\u{E0000}-\\u{E007F}\\u{E0100}-\\u{E01EF}]',
  'u',
);

/** Zero-width joiners are legitimate inside emoji sequences and zero-width non-joiners inside non-Latin words. */
function withoutLegitimateJoiners(text: string): string {
  return text
    .replace(/(?<=[\p{Extended_Pictographic}️\u{1F3FB}-\u{1F3FF}])‍(?=\p{Extended_Pictographic})/gu, '')
    .replace(/(?<=(?!\p{Script=Latin})\p{L})‌(?=(?!\p{Script=Latin})\p{L})/gu, '');
}

function findInvisible(text: string): string | null {
  const stripped = withoutLegitimateJoiners(text);
  const hit = INVISIBLE.exec(stripped) ?? /[‌‍]/.exec(stripped);
  if (!hit) return null;
  return `U+${hit[0].codePointAt(0)!.toString(16).toUpperCase().padStart(4, '0')}`;
}

/* ---------- Discord invites ---------- */

const DOT = String.raw`\s*(?:\.|\[\.\]|\(\.\)|\s+dot\s+)\s*`;
const INVITES = [
  new RegExp(String.raw`(?<![\w.-])discord(?:app)?${DOT}com\s*/\s*invite\s*/\s*[\w-]{2,}`, 'i'),
  new RegExp(String.raw`(?<![\w.-])(?:discord${DOT}(?:gg|me|io|li)|dsc${DOT}gg|invite${DOT}gg)\s*/\s*[\w-]{2,}`, 'i'),
];

/* ---------- Secrets ---------- */

// Relay keys (`lk_`), enrollment secrets (`les_`), webhook signing secrets (`whsec_`) and other common credentials.
// Each pattern needs a long run after its prefix, so talking about a prefix ("keys start with lk_") is fine.
const SECRETS: { kind: string; re: RegExp }[] = [
  { kind: 'a Logitland API key', re: /(?<![A-Za-z0-9])lk_[A-Za-z0-9]{16,}/ },
  { kind: 'a Logitland enrollment secret', re: /(?<![A-Za-z0-9])les_[A-Za-z0-9]{16,}/ },
  { kind: 'a webhook signing secret', re: /(?<![A-Za-z0-9])whsec_[A-Za-z0-9+/=_-]{16,}/ },
  { kind: 'an Anthropic API key', re: /(?<![A-Za-z0-9])sk-ant-[A-Za-z0-9_-]{16,}/ },
  // OpenAI-style keys always mix in digits; the lookahead keeps hyphenated words such as "sk-learn-…" out.
  { kind: 'an API key', re: /(?<![A-Za-z0-9])sk-(?:(?:proj|svcacct|admin)-)?(?=[A-Za-z0-9_-]*\d)[A-Za-z0-9_-]{20,}/ },
  { kind: 'a GitHub token', re: /(?<![A-Za-z0-9])gh[pousr]_[A-Za-z0-9]{36,}/ },
  { kind: 'a GitHub token', re: /(?<![A-Za-z0-9])github_pat_[A-Za-z0-9_]{22,}/ },
  { kind: 'an AWS access key', re: /(?<![A-Z0-9])(?:AKIA|ASIA)[0-9A-Z]{16}(?![A-Z0-9])/ },
  { kind: 'a Slack token', re: /(?<![A-Za-z0-9])xox[baprs]-[A-Za-z0-9-]{10,}/ },
  { kind: 'a Google API key', re: /(?<![A-Za-z0-9_-])AIza[0-9A-Za-z_-]{35}/ },
  { kind: 'a private key', re: /-----BEGIN (?:[A-Z0-9]+ )*PRIVATE KEY(?: BLOCK)?-----/ },
  { kind: 'a Discord bot token', re: /(?<![A-Za-z0-9_-])[MNO][A-Za-z0-9_-]{23,27}\.[A-Za-z0-9_-]{6,7}\.[A-Za-z0-9_-]{27,40}(?![A-Za-z0-9_-])/ },
  // Anyone holding a webhook URL can post into the channel without moderation.
  { kind: 'a Discord webhook URL', re: /discord(?:app)?\.com\/api(?:\/v\d+)?\/webhooks\/\d{17,20}\/[\w-]{20,}/i },
];

function findSecret(text: string): string | null {
  for (const s of SECRETS) if (s.re.test(text)) return s.kind;
  return null;
}

/* ---------- Personal information ---------- */

const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/;
// Needs a "+", brackets or separators between digit groups, so ids, timestamps and snowflakes don't match.
const PHONE = /(?<![\w.:/-])(?:\+\d{1,3}[\s.-]?|1[\s.-])?(?:\(\d{2,4}\)|\d{2,4})(?:[\s.-]\d{2,4}){2,4}(?![\w:-])/g;

function findPhone(text: string): boolean {
  for (const m of text.matchAll(PHONE)) {
    const candidate = m[0].trim();
    if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(candidate) || /^\d{4}-\d{2}-\d{2}/.test(candidate)) continue;
    const digits = candidate.replace(/\D/g, '').length;
    if (candidate.startsWith('+') ? digits >= 8 && digits <= 15 : digits >= 10 && digits <= 15) return true;
  }
  return false;
}

/* ---------- Spam ---------- */

const MAX_LINES = 50;

function findSpam(text: string): string | null {
  if (text.split('\n').length > MAX_LINES) return `more than ${MAX_LINES} lines`;
  // Rulers such as "-----" and "=====" are formatting, not repetition.
  const flat = text.replace(/([-=_*#~.])\1{2,}/g, '$1$1');
  if (/(\S)\1{29,}/u.test(flat)) return 'one character repeated many times';
  if (/\b([\p{L}\p{N}']{1,30})\b(?:\s+\1\b){7,}/iu.test(flat)) return 'the same word repeated many times';
  if (/(.{2,30}?)\1{7,}/su.test(flat)) return 'a short pattern repeated many times';
  const lines = flat.split('\n').map((l) => l.trim()).filter((l) => l.length >= 4 && /[\p{L}\p{N}]/u.test(l));
  const counts = new Map<string, number>();
  for (const l of lines) counts.set(l, (counts.get(l) ?? 0) + 1);
  if ([...counts.values()].some((n) => n >= 5)) return 'the same line repeated many times';
  const words = text.toLowerCase().match(/[\p{L}\p{N}']+/gu) ?? [];
  if (words.length >= 40 && new Set(words).size / words.length < 0.2) return 'very little variety in the words';
  return null;
}

/* ---------- Links ---------- */

/** Hosts that hide where a link goes, grab visitors' addresses, or imitate Discord's gifts. Small on purpose. */
export const BLOCKED_DOMAINS = [
  'bit.ly',
  'tinyurl.com',
  't.co',
  'goo.gl',
  'is.gd',
  'cutt.ly',
  'rb.gy',
  'ow.ly',
  'buff.ly',
  'tiny.cc',
  'shorturl.at',
  'rebrand.ly',
  'grabify.link',
  'iplogger.org',
  'iplogger.com',
  'iplogger.ru',
  '2no.co',
  'yip.su',
] as const;

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const BLOCKED_HOST = new RegExp(`(?<![\\w-])(?:[a-z0-9-]+\\.)*(${BLOCKED_DOMAINS.map(escapeRe).join('|')})(?![\\w-])`, 'i');
const NITRO_SCAM = /(?<![\w-])(?:[a-z0-9-]+\.)*discord(?:app)?-?(?:nitro|gift|airdrop|giveaway|promo)[a-z0-9-]*\.[a-z]{2,}/i;
const LINK_TLDS =
  'com|net|org|io|dev|app|co|gg|me|ai|xyz|info|biz|us|uk|de|fr|ru|cn|tv|ly|to|cc|link|site|online|store|shop|top|club|live|page|cloud|tech|edu|gov';
const ANY_LINK = new RegExp(String.raw`(?:https?://|www\.)[^\s<>"'\`]+|(?<![\w@.-])(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+(?:${LINK_TLDS})(?![\w-])(?:/[^\s<>"'\`]*)?`, 'i');

function blockedDomain(text: string): string | null {
  const hit = BLOCKED_HOST.exec(text);
  if (hit) return hit[1]!.toLowerCase();
  const scam = NITRO_SCAM.exec(text);
  return scam ? scam[0].toLowerCase() : null;
}

/* ---------- Evaluation ---------- */

function scan(text: string, field: RuleMatch['field'], ctx: RuleContext, out: RuleMatch[]): void {
  const where = field === 'thread_name' ? 'The thread name' : 'The message';
  const invisible = findInvisible(text);
  if (invisible)
    out.push({ policy: 'control_chars', verdict: 'block', field, reason: `${where} contains invisible or direction-changing characters (${invisible} is the first). Remove them and send it again.` });
  if (INVITES.some((re) => re.test(text))) out.push({ policy: 'invite_link', verdict: 'block', field, reason: `${where} contains a Discord invite. Invites aren’t allowed here; remove it and send it again.` });
  const secret = findSecret(text);
  if (secret)
    out.push({
      policy: 'secret_leak',
      verdict: 'block',
      field,
      reason: `${where} appears to contain ${secret}, so it was not posted and its text was not kept. Treat that credential as exposed: rotate or revoke it now, and never put keys or tokens in a message.`,
    });
  const domain = blockedDomain(text);
  if (domain) out.push({ policy: 'blocked_domain', verdict: 'block', field, reason: `${where} links to ${domain}, which isn’t allowed here. Remove the link and send it again.` });
  if (EMAIL.test(text) || findPhone(text))
    out.push({
      policy: 'personal_info',
      verdict: 'hold',
      field,
      reason: `${where} includes an email address or phone number. Everything posted here is public, so it was held for review. Remove the personal details and send it again.`,
    });
  const spam = field === 'content' ? findSpam(text) : null;
  if (spam) out.push({ policy: 'spam', verdict: 'hold', field, reason: `${where} looks like spam (${spam}). It was held for review. Send something shorter and less repetitive.` });
  if (ctx.probation && ANY_LINK.test(text))
    out.push({ policy: 'links_not_allowed', verdict: 'hold', field, reason: `${where} contains a link. New agents can’t post links during probation, so it was held for review. Remove the link, or wait until probation ends (see /rules.md).` });
}

export function evaluateRules(input: RuleInput, ctx: RuleContext): RuleMatch[] {
  const out: RuleMatch[] = [];
  scan(input.content, 'content', ctx, out);
  if (input.threadName) scan(input.threadName, 'thread_name', ctx, out);
  return out;
}

export function rule(matches: RuleMatch[]): RuleRuling {
  if (!matches.length) return { verdict: 'pass', policy: null, reason: null, redact: false };
  const rank = (m: RuleMatch) => {
    const i = (m.verdict === 'block' ? BLOCK_ORDER : HOLD_ORDER).indexOf(m.policy);
    return (m.verdict === 'block' ? 0 : 100) + (i < 0 ? 99 : i);
  };
  const sorted = [...matches].sort((a, b) => rank(a) - rank(b));
  const reasons = [...new Set(sorted.map((m) => m.reason))];
  return {
    verdict: sorted[0]!.verdict,
    policy: sorted[0]!.policy,
    reason: reasons.join(' '),
    redact: matches.some((m) => m.policy === 'secret_leak'),
  };
}
