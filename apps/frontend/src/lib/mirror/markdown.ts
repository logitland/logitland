// Discord's markdown subset, as a pure function from text to a small tree. The page draws the tree with
// Svelte, so text only ever reaches the DOM as text: there is no HTML string, no `{@html}`, and nothing to
// escape by hand. The only attribute taken from the message is a link's `href`, and only `http:` and
// `https:` URLs without a user name or password make it that far; anything else stays visible as plain text.
//
// Supported: **bold**, *italic* and _italic_, __underline__, ~~strikethrough~~, ||spoiler||, `code`, fenced
// code blocks, > and >>> quotes, -# subtext, #, ## and ### headings, - and * bullet lists and 1. numbered lists
// (nested by indenting the marker), [masked](links), <links> and plain URLs.
// Everything else (HTML, mentions, other schemes) is text.

export type Inline =
  | { type: 'text'; text: string }
  | { type: 'code'; text: string }
  | { type: 'bold' | 'italic' | 'underline' | 'strike' | 'spoiler'; children: Inline[] }
  /** `masked` links show other words than their address, so the page also shows the host. */
  | { type: 'link'; href: string; host: string; masked: boolean; children: Inline[] };

/** A list's items hold inline words and, for an indented marker, lists of their own. A run that switches between bullets and numbers is two lists. */
export type ListBlock = { type: 'list'; ordered: boolean; start: number; items: { children: Inline[]; sub: ListBlock[] }[] };

export type Block =
  | { type: 'paragraph'; children: Inline[] }
  | { type: 'heading'; level: 1 | 2 | 3; children: Inline[] }
  | { type: 'subtext'; children: Inline[] }
  | { type: 'quote'; children: Inline[] }
  | { type: 'code'; lang: string | null; text: string }
  | ListBlock;

/** Past this the text is cut: Discord allows 4,000 characters at most, and parsing stays cheap. */
export const MAX_LENGTH = 8000;
const MAX_DEPTH = 6;
/** Lists nest this many times below the first; anything indented further stays in the list it is in. */
const MAX_LIST_DEPTH = 3;
const MAX_URL = 2048;
/** A link's words end within this many characters and on the same line, so a run of `[` can't make every one of them scan to the end. */
const MAX_LABEL = 300;

const PUNCTUATION = '\\`*_{}[]()<>#+-.!|~:@/"\'&^=%$;,?';
const isSpace = (c: string | undefined) => c === undefined || c === ' ' || c === '\n' || c === '\t' || c === '\r';
const isWord = (c: string | undefined) => c !== undefined && /[\p{L}\p{N}]/u.test(c);

/* ---------- Links ---------- */

/** The URL as the browser will read it, or null if it isn't a plain web address. */
export function safeUrl(raw: string): { href: string; host: string } | null {
  const text = raw.trim();
  if (!text || text.length > MAX_URL || !/^https?:\/\//i.test(text)) return null;
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return null;
  }
  if ((url.protocol !== 'http:' && url.protocol !== 'https:') || url.username || url.password || !url.hostname) return null;
  return { href: url.href, host: url.hostname };
}

/** Drop the punctuation and closing marks that follow a URL in running text. */
function trimUrl(url: string): string {
  let u = url;
  for (;;) {
    const last = u.at(-1);
    if (last === undefined) return u;
    if ('.,:;!?\'"*_~|'.includes(last)) u = u.slice(0, -1);
    else if (last === ')' && (u.match(/\(/g)?.length ?? 0) < (u.match(/\)/g)?.length ?? 0)) u = u.slice(0, -1);
    else if (last === ']' && (u.match(/\[/g)?.length ?? 0) < (u.match(/\]/g)?.length ?? 0)) u = u.slice(0, -1);
    else return u;
  }
}

/** `[text](address)` starting at `i`: where it ends, the words and the address. */
function maskedLink(s: string, i: number): { end: number; label: string; target: string } | null {
  let depth = 0;
  let j = i;
  for (; j < s.length && j - i <= MAX_LABEL; j++) {
    const c = s[j];
    if (c === '\n') return null;
    if (c === '\\') j++;
    else if (c === '[') depth++;
    else if (c === ']' && --depth === 0) break;
  }
  if (j >= s.length || s[j] !== ']' || s[j + 1] !== '(') return null;
  let parens = 0;
  let k = j + 1;
  for (; k < s.length; k++) {
    const c = s[k];
    if (c === '(') parens++;
    else if (c === ')' && --parens === 0) break;
    else if (c === '\n') return null;
  }
  if (k >= s.length) return null;
  let target = s.slice(j + 2, k).trim();
  // [text](https://example.com "a title"): the title is ignored.
  target = target.replace(/\s+["'][^"']*["']$/, '');
  if (target.startsWith('<') && target.endsWith('>')) target = target.slice(1, -1);
  return { end: k + 1, label: s.slice(i + 1, j), target };
}

/* ---------- Inline ---------- */

const MARKERS: { mark: string; type: 'bold' | 'italic' | 'underline' | 'strike' | 'spoiler' | 'bolditalic' }[] = [
  { mark: '***', type: 'bolditalic' },
  { mark: '**', type: 'bold' },
  { mark: '__', type: 'underline' },
  { mark: '||', type: 'spoiler' },
  { mark: '~~', type: 'strike' },
  { mark: '*', type: 'italic' },
  { mark: '_', type: 'italic' },
];

const runLength = (s: string, i: number, c: string) => {
  let n = 0;
  while (s[i + n] === c) n++;
  return n;
};

/**
 * Where the closing mark is for an opening mark that ended at `from`, or -1. A closing mark follows a
 * non-space, and a run of the same character belongs to the longest mark it can: in `**bold *it***` the
 * run at the end closes the italics and then the bold.
 */
function findClose(s: string, from: number, mark: string): number {
  const c = mark[0]!;
  let j = s.indexOf(mark, from);
  while (j !== -1) {
    const run = runLength(s, j, c);
    if (s[j - 1] !== '\\' && (mark.length === 1 ? run === 1 : run >= mark.length)) {
      const k = c === '~' || c === '|' ? j : j + run - mark.length;
      if (k > from && !isSpace(s[k - 1]) && !(c === '_' && isWord(s[k + mark.length]))) return k;
    }
    j = s.indexOf(mark, j + run);
  }
  return -1;
}

export function parseInline(s: string, depth = 0, links = true): Inline[] {
  const out: Inline[] = [];
  let buf = '';
  const flush = () => {
    if (buf) out.push({ type: 'text', text: buf });
    buf = '';
  };
  // Where a mark's closing search already failed: a later opener of the same mark has fewer places to close, so it fails too. This keeps unclosed marks linear.
  const noClose = new Map<string, number>();
  let i = 0;
  scan: while (i < s.length) {
    const c = s[i]!;

    if (c === '\\' && i + 1 < s.length && PUNCTUATION.includes(s[i + 1]!)) {
      buf += s[i + 1];
      i += 2;
      continue;
    }

    if (c === '`') {
      const run = runLength(s, i, '`');
      const fence = '`'.repeat(run);
      const close = s.indexOf(fence, i + run);
      // A closing run must be exactly as long as the opening one.
      let at = close;
      while (at !== -1 && (s[at + run] === '`' || s[at - 1] === '`')) at = s.indexOf(fence, at + 1);
      if (at !== -1 && at > i + run) {
        flush();
        let code = s.slice(i + run, at);
        if (code.length > 2 && code.startsWith(' ') && code.endsWith(' ')) code = code.slice(1, -1);
        out.push({ type: 'code', text: code });
        i = at + run;
        continue;
      }
      buf += fence;
      i += run;
      continue;
    }

    if (depth < MAX_DEPTH) {
      for (const { mark, type } of MARKERS) {
        if (!s.startsWith(mark, i)) continue;
        // Inside a link's words a spoiler would be a button inside a link.
        if (type === 'spoiler' && !links) continue;
        // The opening mark needs a word right after it, and an underscore mustn't sit inside a word (snake_case).
        if (isSpace(s[i + mark.length])) continue;
        if (mark[0] === '_' && isWord(s[i - 1])) continue;
        // A lone * or _ right before another one is part of a longer mark that found no end.
        if (mark.length === 1 && s[i + 1] === mark) continue;
        const from = i + mark.length;
        if (from >= (noClose.get(mark) ?? Infinity)) continue;
        const close = findClose(s, from, mark);
        if (close === -1) {
          noClose.set(mark, Math.min(from, noClose.get(mark) ?? Infinity));
          continue;
        }
        const inner = parseInline(s.slice(i + mark.length, close), depth + 1, links);
        flush();
        if (type === 'bolditalic') out.push({ type: 'bold', children: [{ type: 'italic', children: inner }] });
        else out.push({ type, children: inner });
        i = close + mark.length;
        continue scan;
      }
    }

    if (c === '[' && links) {
      const link = maskedLink(s, i);
      const safe = link && safeUrl(link.target);
      if (link && safe && link.label.trim()) {
        flush();
        out.push({
          type: 'link',
          href: safe.href,
          host: safe.host,
          masked: true,
          children: depth < MAX_DEPTH ? parseInline(link.label, depth + 1, false) : [{ type: 'text', text: link.label }],
        });
        i = link.end;
        continue;
      }
    }

    if (c === '<' && links) {
      const angle = /^<(https?:\/\/[^\s<>]+)>/.exec(s.slice(i, i + MAX_URL + 2));
      const safe = angle && safeUrl(angle[1]!);
      if (angle && safe) {
        flush();
        out.push({ type: 'link', href: safe.href, host: safe.host, masked: false, children: [{ type: 'text', text: angle[1]! }] });
        i += angle[0].length;
        continue;
      }
    }

    if ((c === 'h' || c === 'H') && links && !isWord(s[i - 1])) {
      const m = /^https?:\/\/[^\s<>]+/i.exec(s.slice(i, i + MAX_URL + 2));
      if (m) {
        const url = trimUrl(m[0]);
        const safe = safeUrl(url);
        if (safe) {
          flush();
          out.push({ type: 'link', href: safe.href, host: safe.host, masked: false, children: [{ type: 'text', text: url }] });
          i += url.length;
          continue;
        }
      }
    }

    buf += c;
    i++;
  }
  flush();
  return out;
}

/* ---------- Blocks ---------- */

const FENCE = /```(?:([A-Za-z0-9_+#.-]{1,20})\n)?([\s\S]*?)```/g;
/** A bullet (- or *) or a number and a dot, then a space and some words. `-#` subtext and `**bold**` have no space after the first mark, so they aren't rows. */
const LIST_ROW = /^( *)([-*]|\d{1,9}\.) +(\S.*)$/;

interface ListRow {
  indent: number;
  ordered: boolean;
  num: number;
  text: string;
}

/** Turns consecutive list rows into lists. A row indented further than the first nests under the row before it. */
function buildLists(rows: ListRow[], depth = 0): ListBlock[] {
  const base = rows[0]!.indent;
  const lists: ListBlock[] = [];
  let list: ListBlock | null = null;
  for (let i = 0; i < rows.length;) {
    const row = rows[i]!;
    let end = i + 1;
    if (depth < MAX_LIST_DEPTH) while (end < rows.length && rows[end]!.indent > base) end++;
    if (!list || list.ordered !== row.ordered) lists.push((list = { type: 'list', ordered: row.ordered, start: row.ordered ? row.num : 1, items: [] }));
    const nested = rows.slice(i + 1, end);
    list.items.push({ children: parseInline(row.text), sub: nested.length ? buildLists(nested, depth + 1) : [] });
    i = end;
  }
  return lists;
}

function lines(text: string): Block[] {
  const blocks: Block[] = [];
  const rows = text.split('\n');
  let para: string[] = [];
  const endParagraph = () => {
    const joined = para.join('\n').replace(/^\n+|\n+$/g, '');
    if (joined.trim()) blocks.push({ type: 'paragraph', children: parseInline(joined) });
    para = [];
  };
  for (let n = 0; n < rows.length; n++) {
    const row = rows[n]!;
    let m: RegExpExecArray | null;
    if (/^>>> ?/.test(row)) {
      endParagraph();
      const rest = [row.replace(/^>>> ?/, ''), ...rows.slice(n + 1)].join('\n').trim();
      if (rest) blocks.push({ type: 'quote', children: parseInline(rest) });
      return blocks;
    }
    if (/^> /.test(row) || row === '>') {
      endParagraph();
      const quoted: string[] = [];
      while (n < rows.length && (/^> /.test(rows[n]!) || rows[n] === '>')) quoted.push(rows[n++]!.slice(2));
      n--;
      blocks.push({ type: 'quote', children: parseInline(quoted.join('\n')) });
    } else if ((m = LIST_ROW.exec(row))) {
      endParagraph();
      const items: ListRow[] = [];
      for (; n < rows.length; n++) {
        const r = LIST_ROW.exec(rows[n]!);
        if (!r) break;
        items.push({ indent: r[1]!.length, ordered: r[2]!.endsWith('.'), num: Number.parseInt(r[2]!, 10), text: r[3]! });
      }
      n--;
      blocks.push(...buildLists(items));
    } else if ((m = /^-# +(\S.*)$/.exec(row))) {
      endParagraph();
      blocks.push({ type: 'subtext', children: parseInline(m[1]!) });
    } else if ((m = /^(#{1,3}) +(\S.*)$/.exec(row))) {
      endParagraph();
      blocks.push({ type: 'heading', level: m[1]!.length as 1 | 2 | 3, children: parseInline(m[2]!) });
    } else {
      para.push(row);
    }
  }
  endParagraph();
  return blocks;
}

export function parseMarkdown(source: string): Block[] {
  const src = source.length > MAX_LENGTH ? `${source.slice(0, MAX_LENGTH)}…` : source;
  const blocks: Block[] = [];
  let last = 0;
  for (const m of src.matchAll(FENCE)) {
    const code = m[2]!.replace(/^\n/, '').replace(/\n$/, '');
    blocks.push(...lines(src.slice(last, m.index)));
    // An empty fence isn't a code block; leave it as the characters it was.
    if (code.trim() === '' && !m[1]) blocks.push({ type: 'paragraph', children: [{ type: 'text', text: m[0] }] });
    else blocks.push({ type: 'code', lang: m[1] ?? null, text: code });
    last = m.index + m[0].length;
  }
  blocks.push(...lines(src.slice(last)));
  return blocks;
}

/* ---------- Plain text ---------- */

function inlineText(nodes: Inline[]): string {
  return nodes.map((n) => (n.type === 'text' || n.type === 'code' ? n.text : n.type === 'spoiler' ? '' : inlineText(n.children))).join('');
}

/** The words with every mark removed, for excerpts. Spoilers stay hidden. */
export function plainText(source: string): string {
  const listText = (l: ListBlock): string => l.items.map((it) => [inlineText(it.children), ...it.sub.map(listText)].join(' ')).join(' ');
  return parseMarkdown(source)
    .map((b) => (b.type === 'code' ? b.text : b.type === 'list' ? listText(b) : inlineText(b.children)))
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}
