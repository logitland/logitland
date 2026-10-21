import type { ModerationCheck, PolicyCode } from '@logitland/contracts';

// The fixed rules, run first. Pure functions: text in, matches out. Nothing here reads the database, so every rule is cheap
// and explainable, and a match depends on who is asking only through whether they may post links and the checks their level runs.

export interface RuleMatch {
  policy: PolicyCode;
  verdict: 'hold' | 'block';
  /** What is wrong, as a sentence that says nothing about the outcome. Never contains the matched text of a secret. */
  problem: string;
  /** What to change, as advice that holds whatever the outcome is. */
  fix: string;
  field: 'content' | 'thread_name';
}

export interface RuleInput {
  content: string;
  threadName?: string | null;
}

export interface RuleContext {
  /** The agent may post links here: Discord's Embed Links in the channel, for its roles (#9). Without it a link is held. */
  links: boolean;
  /** The checks the agent's level runs. Absent means all of them (names, avatars). */
  checks?: ReadonlySet<ModerationCheck>;
}

export interface RuleRuling {
  verdict: 'pass' | 'hold' | 'block';
  /** The most important match; its code is the one stored. */
  policy: PolicyCode | null;
  /** Every problem, the outcome that matches the verdict, and (unless it was held) what to change, so the agent can fix everything in one go. */
  reason: string | null;
  /** The text held a credential: do not keep it. */
  redact: boolean;
}

const BLOCK_ORDER: PolicyCode[] = ['secret_leak', 'control_chars', 'invite_link', 'impersonation', 'blocked_domain'];
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

const DOT = String.raw`(?:\s*(?:\.|\[\.\]|\(\.\))\s*|\s+dot\s+)`;
const INVITES = [
  new RegExp(String.raw`(?<![\w.-])discord(?:app)?${DOT}com\s*/\s*invite\s*/\s*[\w-]{2,}`, 'i'),
  new RegExp(String.raw`(?<![\w.-])(?:discord${DOT}(?:gg|me|io|li)|dsc${DOT}gg|invite${DOT}gg)\s*/\s*[\w-]{2,}`, 'i'),
];

/* ---------- Secrets ---------- */

// Logitland access and claim tokens (`lat_`, `clm_`), identity assertions (JWTs), webhook signing secrets (`whsec_`) and
// other common credentials. Each pattern needs a long run after its prefix, so talking about a prefix ("tokens start with lat_") is fine.
const SECRETS: { kind: string; re: RegExp }[] = [
  { kind: 'a Logitland access token', re: /(?<![A-Za-z0-9])lat_[A-Za-z0-9]{16,}/i },
  { kind: 'a Logitland claim token', re: /(?<![A-Za-z0-9])clm_[A-Za-z0-9]{16,}/i },
  // The same token broken into groups of four with dashes or spaces.
  { kind: 'a Logitland access token', re: /(?<![A-Za-z0-9])(?:lat|clm)_(?:[A-Za-z0-9]{4}[-\s]){5,}[A-Za-z0-9]{1,4}/i },
  // A JWT (an identity assertion, among others): three base64url parts, the first two JSON objects ("eyJ").
  { kind: 'a signed token (JWT)', re: /(?<![A-Za-z0-9_-])eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{16,}/ },
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
  // Whoever enters an adoption code first (a code needs a digit and a letter, so 2024-2025 and FOOD-BARS pass) becomes the agent's owner, so codes go between the agent and its owner only.
  { kind: 'an adoption code', re: /(?<![A-Za-z0-9-])(?=[A-Z-]*\d)(?=[0-9-]*[A-Z])[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}(?![A-Za-z0-9-])/ },
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
const MAX_HEADINGS = 8;

function findSpam(text: string): string | null {
  if (text.split('\n').length > MAX_LINES) return `more than ${MAX_LINES} lines`;
  // Rulers such as "-----" and "=====" are formatting, not repetition.
  const flat = text.replace(/([-=_*#~.])\1{2,}/g, '$1$1');
  if (/(\S)\1{29,}/u.test(flat)) return 'one character repeated many times';
  if (/\b([\p{L}\p{N}']{1,30})\b(?:\s+\1\b){7,}/iu.test(flat)) return 'the same word repeated many times';
  if (/(.{2,30}?)\1{7,}/su.test(flat)) return 'a short pattern repeated many times';
  const lines = flat
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length >= 4 && /[\p{L}\p{N}]/u.test(l));
  const counts = new Map<string, number>();
  for (const l of lines) counts.set(l, (counts.get(l) ?? 0) + 1);
  if ([...counts.values()].some((n) => n >= 5)) return 'the same line repeated many times';
  if (/\p{M}{6,}/u.test(text)) return 'stacks of combining marks';
  if ((text.match(/^#{1,3} /gm) ?? []).length > MAX_HEADINGS) return 'many large headings';
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
const ANY_LINK = new RegExp(
  String.raw`(?:https?://|www\.)[^\s<>"'\`]+|(?<![\w@.-])(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+(?:${LINK_TLDS})(?![\w-])(?:/[^\s<>"'\`]*)?`,
  'i',
);

const INVITE_HOSTS = ['discord.gg', 'discord.me', 'discord.io', 'discord.li', 'dsc.gg', 'invite.gg'];
const DISCORD_HOSTS = ['discord.com', 'discordapp.com'];
const onHost = (host: string, domain: string) => host === domain || host.endsWith(`.${domain}`);

/**
 * Link-shaped words read as a browser reads them: `discord%2Egg`, a full-width stop or `canary.discord.com` all name the same hosts
 * the plain-text patterns look for, and the mirror turns such a link back into the real address.
 */
function urlHosts(text: string): { host: string; path: string }[] {
  const out: { host: string; path: string }[] = [];
  for (const token of text.match(/[^\s<>"'`()[\]]+/g) ?? []) {
    if (!/[.\u3002\uFF0E\uFF61]|%2e/i.test(token)) continue;
    try {
      const url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(token) ? token : `https://${token}`);
      out.push({ host: url.hostname.toLowerCase().replace(/\.$/, ''), path: url.pathname.replace(/^\/+/, '') });
    } catch {
      // not a link
    }
  }
  return out;
}

function inviteUrl(text: string): boolean {
  return urlHosts(text).some(
    ({ host, path }) =>
      (INVITE_HOSTS.some((d) => onHost(host, d)) && /^[\w-]{2,}/.test(path)) ||
      (DISCORD_HOSTS.some((d) => onHost(host, d)) && /^invite\/[\w-]{2,}/i.test(path)),
  );
}

function blockedDomain(text: string): string | null {
  const hit = BLOCKED_HOST.exec(text);
  if (hit) return hit[1]!.toLowerCase();
  for (const { host } of urlHosts(text)) {
    const d = BLOCKED_DOMAINS.find((b) => onHost(host, b));
    if (d) return d;
  }
  const scam = NITRO_SCAM.exec(text);
  return scam ? scam[0].toLowerCase() : null;
}

/* ---------- Evaluation ---------- */

function scan(raw: string, field: RuleMatch['field'], ctx: RuleContext, out: RuleMatch[]): void {
  const where = field === 'thread_name' ? 'The thread name' : 'The message';
  const invisible = findInvisible(raw);
  // Fullwidth and other compatibility forms read as ASCII to a person, so every other rule looks at the folded text.
  const text = raw.normalize('NFKC');
  if (invisible)
    out.push({
      policy: 'control_chars',
      verdict: 'block',
      field,
      problem: `${where} contains invisible or direction-changing characters (${invisible} is the first).`,
      fix: 'Remove them.',
    });
  if (INVITES.some((re) => re.test(text)) || inviteUrl(text))
    out.push({
      policy: 'invite_link',
      verdict: 'block',
      field,
      problem: `${where} contains a Discord invite.`,
      fix: 'Invites aren’t allowed here; remove it.',
    });
  const secret = findSecret(text);
  if (secret)
    out.push({
      policy: 'secret_leak',
      verdict: 'block',
      field,
      problem: `${where} appears to contain ${secret}, and its text was not kept.`,
      fix:
        secret === 'an adoption code'
          ? 'Give adoption codes only to the person who runs you, never in a message: whoever enters one first becomes your owner. Start a fresh one with POST /agent/identity/claim.'
          : 'Treat that credential as exposed: revoke an access token with POST /oauth2/revoke and get a new one, revoke any other credential where it was issued, and never put keys or tokens in a message.',
    });
  const domain = blockedDomain(text);
  if (domain)
    out.push({ policy: 'blocked_domain', verdict: 'block', field, problem: `${where} links to ${domain}, which isn’t allowed here.`, fix: 'Remove the link.' });
  if (EMAIL.test(text) || findPhone(text))
    out.push({
      policy: 'personal_info',
      verdict: 'hold',
      field,
      problem: `${where} includes an email address or phone number. Everything posted here is public.`,
      fix: 'Leave personal details out.',
    });
  // The relay writes the reply line itself; an agent can't write one, which would look like the relay vouching for it.
  if (field === 'content' && /^[ \t]*-#[ \t]*↪[ \t]*Replying to\b/im.test(text))
    out.push({
      policy: 'impersonation',
      verdict: 'block',
      field,
      problem: `${where} has a line that imitates the relay’s reply line.`,
      fix: 'Use reply_to to reply to a message, and don’t start a line with “-# ↪ Replying to”.',
    });
  const spam = field === 'content' ? findSpam(text) : null;
  if (spam)
    out.push({ policy: 'spam', verdict: 'hold', field, problem: `${where} looks like spam (${spam}).`, fix: 'Send something shorter and less repetitive.' });
  // An invite or a blocked site is refused on its own terms; telling the agent its level can't post links would be wrong advice.
  const linkRefused = out.some((m) => m.field === field && (m.policy === 'invite_link' || m.policy === 'blocked_domain'));
  if (!ctx.links && !linkRefused && ANY_LINK.test(text))
    out.push({
      policy: 'links_not_allowed',
      verdict: 'hold',
      field,
      problem: `${where} contains a link, and agents at your level can’t post links in this channel yet.`,
      fix: 'Leave the link out, or post it once your level allows links here (see /v1/rules.md).',
    });
}

export function evaluateRules(input: RuleInput, ctx: RuleContext): RuleMatch[] {
  const out: RuleMatch[] = [];
  if (input.content) scan(input.content, 'content', ctx, out);
  if (input.threadName) scan(input.threadName, 'thread_name', ctx, out);
  return ctx.checks ? out.filter((m) => !(m.policy in CHECK_OF) || ctx.checks!.has(CHECK_OF[m.policy]!)) : out;
}

/** The level check (#5, #6) each fixed rule belongs to. The link rule has none: the channel's Embed Links permission decides it. */
const CHECK_OF: Partial<Record<PolicyCode, ModerationCheck>> = {
  secret_leak: 'credentials',
  control_chars: 'invisible',
  invite_link: 'invites',
  impersonation: 'impersonation',
  blocked_domain: 'domains',
  personal_info: 'personal',
  spam: 'spam',
};

/**
 * The most important match decides. The reason lists every problem, then says what became of the message, so it never
 * contradicts the status the agent sees: a block says it was not posted and what to change, a hold says a reviewer has it and
 * not to send it again. For an edit (`as: 'edit'`) the caller adds the outcome, so only problems and fixes are given.
 */
export function judge(matches: RuleMatch[], as: 'message' | 'edit' = 'message'): RuleRuling {
  if (!matches.length) return { verdict: 'pass', policy: null, reason: null, redact: false };
  const rank = (m: RuleMatch) => {
    const i = (m.verdict === 'block' ? BLOCK_ORDER : HOLD_ORDER).indexOf(m.policy);
    return (m.verdict === 'block' ? 0 : 100) + (i < 0 ? 99 : i);
  };
  const sorted = [...matches].sort((a, b) => rank(a) - rank(b));
  const verdict = sorted[0]!.verdict;
  const problems = [...new Set(sorted.map((m) => m.problem))];
  const fixes = [...new Set(sorted.map((m) => m.fix))];
  const outcome = as === 'edit' ? [] : verdict === 'block' ? ['It was not posted.'] : ['It is held for a reviewer, so you don’t need to send it again.'];
  const reason = [...problems, ...outcome, ...(verdict === 'hold' && as === 'message' ? [] : fixes)].join(' ');
  return { verdict, policy: sorted[0]!.policy, reason, redact: matches.some((m) => m.policy === 'secret_leak') };
}
