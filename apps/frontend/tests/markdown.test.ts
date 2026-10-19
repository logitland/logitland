import { describe, expect, it } from 'vitest';
import { MAX_LENGTH, parseInline, parseMarkdown, plainText, safeUrl, type Block, type Inline, type ListBlock } from '../src/lib/mirror/markdown.ts';

const inline = (s: string) => parseInline(s);
const text = (t: string): Inline => ({ type: 'text', text: t });
const para = (s: string) => {
  const b = parseMarkdown(s)[0];
  if (b?.type !== 'paragraph') throw new Error(`not a paragraph: ${JSON.stringify(b)}`);
  return b.children;
};

/** Every string a tree can hand to the page, tagged by where it ends up. */
function strings(blocks: Block[]) {
  const texts: string[] = [];
  const hrefs: string[] = [];
  const kinds = new Set<string>();
  const walk = (nodes: Inline[]) => {
    for (const n of nodes) {
      kinds.add(n.type);
      if (n.type === 'text' || n.type === 'code') texts.push(n.text);
      else {
        if (n.type === 'link') hrefs.push(n.href);
        walk(n.children);
      }
    }
  };
  const walkList = (l: ListBlock) => {
    for (const item of l.items) {
      walk(item.children);
      item.sub.forEach(walkList);
    }
  };
  for (const b of blocks) {
    kinds.add(b.type);
    if (b.type === 'code') texts.push(b.text);
    else if (b.type === 'list') walkList(b);
    else walk(b.children);
  }
  return { texts, hrefs, kinds };
}

describe('inline formatting', () => {
  it('reads plain text as text', () => {
    expect(inline('hello world')).toEqual([text('hello world')]);
    expect(inline('')).toEqual([]);
  });

  it('reads bold, italic, underline, strikethrough and spoilers', () => {
    expect(inline('**b**')).toEqual([{ type: 'bold', children: [text('b')] }]);
    expect(inline('*i*')).toEqual([{ type: 'italic', children: [text('i')] }]);
    expect(inline('_i_')).toEqual([{ type: 'italic', children: [text('i')] }]);
    expect(inline('__u__')).toEqual([{ type: 'underline', children: [text('u')] }]);
    expect(inline('~~s~~')).toEqual([{ type: 'strike', children: [text('s')] }]);
    expect(inline('||secret||')).toEqual([{ type: 'spoiler', children: [text('secret')] }]);
  });

  it('keeps the words around a mark', () => {
    expect(inline('a **b** c')).toEqual([text('a '), { type: 'bold', children: [text('b')] }, text(' c')]);
  });

  it('reads bold italic and nested marks', () => {
    expect(inline('***both***')).toEqual([{ type: 'bold', children: [{ type: 'italic', children: [text('both')] }] }]);
    expect(inline('**bold *and italic***')).toEqual([{ type: 'bold', children: [text('bold '), { type: 'italic', children: [text('and italic')] }] }]);
    expect(inline('*a **b** c*')).toEqual([{ type: 'italic', children: [text('a '), { type: 'bold', children: [text('b')] }, text(' c')] }]);
    expect(inline('__~~gone~~__')).toEqual([{ type: 'underline', children: [{ type: 'strike', children: [text('gone')] }] }]);
  });

  it('leaves unmatched marks as text', () => {
    expect(inline('**oops')).toEqual([text('**oops')]);
    expect(inline('a * b * c')).toEqual([text('a * b * c')]);
    expect(inline('2 * 3 * 4')).toEqual([text('2 * 3 * 4')]);
    expect(inline('~~never closed')).toEqual([text('~~never closed')]);
    expect(inline('||')).toEqual([text('||')]);
    expect(inline('** **')).toEqual([text('** **')]);
  });

  it('does not italicise snake_case', () => {
    expect(inline('use snake_case_names here')).toEqual([text('use snake_case_names here')]);
    expect(inline('_real_ italics')).toEqual([{ type: 'italic', children: [text('real')] }, text(' italics')]);
  });

  it('honours backslash escapes', () => {
    expect(inline('\\*not italic\\*')).toEqual([text('*not italic*')]);
    expect(inline('\\_a\\_')).toEqual([text('_a_')]);
    expect(inline('back\\slash')).toEqual([text('back\\slash')]);
  });

  it('reads inline code literally', () => {
    expect(inline('`**not bold**`')).toEqual([{ type: 'code', text: '**not bold**' }]);
    expect(inline('``a ` b``')).toEqual([{ type: 'code', text: 'a ` b' }]);
    expect(inline('`unclosed')).toEqual([text('`unclosed')]);
    expect(inline('``')).toEqual([text('``')]);
  });

  it('stops nesting at a safe depth', () => {
    const deep = '*'.repeat(1) + 'a'.repeat(3) + '*';
    expect(inline(deep)).toHaveLength(1);
    const nested = '||'.repeat(40) + 'x' + '||'.repeat(40);
    expect(() => parseInline(nested)).not.toThrow();
  });
});

describe('links', () => {
  it('reads a masked link and says where it goes', () => {
    expect(inline('[the table](https://example.com/t?a=1)')).toEqual([
      { type: 'link', href: 'https://example.com/t?a=1', host: 'example.com', masked: true, children: [text('the table')] },
    ]);
  });

  it('reads formatting inside a masked link, but no link inside it', () => {
    const [link] = inline('[**bold** https://other.example](https://example.com)');
    expect(link).toMatchObject({ type: 'link', href: 'https://example.com/', masked: true });
    const inner = (link as Extract<Inline, { type: 'link' }>).children;
    expect(inner.some((n) => n.type === 'link')).toBe(false);
    expect(inner[0]).toEqual({ type: 'bold', children: [text('bold')] });
  });

  it('reads plain URLs and keeps the punctuation after them out', () => {
    expect(inline('see https://example.com/a.')).toEqual([
      text('see '),
      { type: 'link', href: 'https://example.com/a', host: 'example.com', masked: false, children: [text('https://example.com/a')] },
      text('.'),
    ]);
    expect(inline('(https://example.com/x)')).toEqual([
      text('('),
      { type: 'link', href: 'https://example.com/x', host: 'example.com', masked: false, children: [text('https://example.com/x')] },
      text(')'),
    ]);
    expect(inline('https://en.wikipedia.org/wiki/Foo_(bar)')[0]).toMatchObject({ href: 'https://en.wikipedia.org/wiki/Foo_(bar)' });
    expect(inline('**https://example.com**')[0]).toMatchObject({ type: 'bold' });
  });

  it('reads <url> and does not link inside a word', () => {
    expect(inline('<https://example.com/a>')[0]).toMatchObject({ type: 'link', href: 'https://example.com/a', masked: false });
    expect(inline('xhttps://example.com')).toEqual([text('xhttps://example.com')]);
  });

  it('does not put a spoiler button inside a link', () => {
    const [link] = inline('[||secret||](https://example.com)');
    expect(link).toMatchObject({ type: 'link', children: [text('||secret||')] });
    expect(inline('||[x](https://example.com)||')).toEqual([{ type: 'spoiler', children: [expect.objectContaining({ type: 'link' })] }]);
  });

  it('ignores a title after the address', () => {
    expect(inline('[x](https://example.com "A title")')[0]).toMatchObject({ type: 'link', href: 'https://example.com/' });
  });

  it('allows only http and https', () => {
    expect(safeUrl('https://example.com')?.href).toBe('https://example.com/');
    expect(safeUrl('HTTP://EXAMPLE.COM/x')?.href).toBe('http://example.com/x');
    for (const bad of [
      'javascript:alert(1)',
      'JaVaScRiPt:alert(1)',
      ' javascript:alert(1)',
      'data:text/html,<script>alert(1)</script>',
      'vbscript:x',
      'file:///etc/passwd',
      'ftp://example.com',
      '//evil.example',
      'https:evil.example',
      'https://',
      'https://user:pass@example.com',
      'https://user@example.com',
      '',
      'mailto:a@b.c',
      'https://exa mple.com',
    ]) {
      expect(safeUrl(bad), bad).toBeNull();
    }
    expect(safeUrl(`https://example.com/${'a'.repeat(3000)}`)).toBeNull();
  });
});

describe('blocks', () => {
  it('reads paragraphs and keeps line breaks', () => {
    expect(parseMarkdown('one\ntwo')).toEqual([{ type: 'paragraph', children: [text('one\ntwo')] }]);
    expect(parseMarkdown('\n\none\n\n')).toEqual([{ type: 'paragraph', children: [text('one')] }]);
    expect(parseMarkdown('')).toEqual([]);
    expect(parseMarkdown('   \n  ')).toEqual([]);
  });

  it('reads headings up to three levels', () => {
    expect(parseMarkdown('# one\n## two\n### three')).toEqual([
      { type: 'heading', level: 1, children: [text('one')] },
      { type: 'heading', level: 2, children: [text('two')] },
      { type: 'heading', level: 3, children: [text('three')] },
    ]);
    expect(parseMarkdown('#### four')).toEqual([{ type: 'paragraph', children: [text('#### four')] }]);
    expect(parseMarkdown('#nospace')).toEqual([{ type: 'paragraph', children: [text('#nospace')] }]);
    expect(parseMarkdown('# **bold** title')[0]).toMatchObject({ type: 'heading', children: [{ type: 'bold' }, text(' title')] });
  });

  it('reads subtext', () => {
    expect(parseMarkdown('-# small print')).toEqual([{ type: 'subtext', children: [text('small print')] }]);
    expect(parseMarkdown('-#nospace')).toEqual([{ type: 'paragraph', children: [text('-#nospace')] }]);
  });

  it('reads quotes: consecutive lines together, and >>> to the end', () => {
    expect(parseMarkdown('> a\n> b\nafter')).toEqual([
      { type: 'quote', children: [text('a\nb')] },
      { type: 'paragraph', children: [text('after')] },
    ]);
    expect(parseMarkdown('before\n>>> a\nb\n**c**')).toEqual([
      { type: 'paragraph', children: [text('before')] },
      { type: 'quote', children: [text('a\nb\n'), { type: 'bold', children: [text('c')] }] },
    ]);
    expect(parseMarkdown('>no space')).toEqual([{ type: 'paragraph', children: [text('>no space')] }]);
  });

  it('reads fenced code blocks literally, with an optional language', () => {
    expect(parseMarkdown('```py\nprint("**hi**")\n```')).toEqual([{ type: 'code', lang: 'py', text: 'print("**hi**")' }]);
    expect(parseMarkdown('```\nplain\n```')).toEqual([{ type: 'code', lang: null, text: 'plain' }]);
    expect(parseMarkdown('```one line```')).toEqual([{ type: 'code', lang: null, text: 'one line' }]);
    expect(parseMarkdown('a\n```\nx\n```\nb')).toEqual([
      { type: 'paragraph', children: [text('a')] },
      { type: 'code', lang: null, text: 'x' },
      { type: 'paragraph', children: [text('b')] },
    ]);
    expect(parseMarkdown('```\n# not a heading\n> not a quote\n```')).toEqual([{ type: 'code', lang: null, text: '# not a heading\n> not a quote' }]);
  });

  it('leaves an unclosed fence as text', () => {
    expect(parseMarkdown('```\nnever closed')).toEqual([{ type: 'paragraph', children: [text('```\nnever closed')] }]);
  });

  it('does not read mentions or HTML as anything', () => {
    expect(para('<@123456789012345678> <#123456789012345678>')).toEqual([text('<@123456789012345678> <#123456789012345678>')]);
    expect(para('<b>bold</b>')).toEqual([text('<b>bold</b>')]);
  });

  it('reads bullet lists with - or *', () => {
    expect(parseMarkdown('- one\n- two')).toEqual([
      {
        type: 'list',
        ordered: false,
        start: 1,
        items: [
          { children: [text('one')], sub: [] },
          { children: [text('two')], sub: [] },
        ],
      },
    ]);
    expect(parseMarkdown('* one\n* two')[0]).toMatchObject({ type: 'list', ordered: false });
    expect(parseMarkdown('- **bold** item')[0]).toMatchObject({ type: 'list', items: [{ children: [{ type: 'bold' }, text(' item')] }] });
  });

  it('reads numbered lists and keeps the first number', () => {
    expect(parseMarkdown('1. a\n2. b')).toEqual([
      {
        type: 'list',
        ordered: true,
        start: 1,
        items: [
          { children: [text('a')], sub: [] },
          { children: [text('b')], sub: [] },
        ],
      },
    ]);
    expect(parseMarkdown('3. c\n4. d')[0]).toMatchObject({ type: 'list', ordered: true, start: 3 });
  });

  it('nests a list under the row above when the marker is indented', () => {
    const [list] = parseMarkdown('- a\n  - a1\n  - a2\n- b\n   1. b1');
    expect(list).toMatchObject({ type: 'list', ordered: false });
    const l = list as ListBlock;
    expect(l.items.map((i) => i.children)).toEqual([[text('a')], [text('b')]]);
    expect(l.items[0]!.sub).toMatchObject([{ type: 'list', ordered: false, items: [{ children: [text('a1')] }, { children: [text('a2')] }] }]);
    expect(l.items[1]!.sub).toMatchObject([{ type: 'list', ordered: true, start: 1, items: [{ children: [text('b1')] }] }]);
  });

  it('starts a new list when the rows switch between bullets and numbers', () => {
    expect(parseMarkdown('- a\n1. b\n- c').map((b) => (b.type === 'list' ? b.ordered : b.type))).toEqual([false, true, false]);
  });

  it('keeps going past the deepest level instead of losing words', () => {
    const deep = parseMarkdown('- 1\n - 2\n  - 3\n   - 4\n    - 5\n     - 6');
    expect(plainText('- 1\n - 2\n  - 3\n   - 4\n    - 5\n     - 6')).toBe('1 2 3 4 5 6');
    expect(deep).toHaveLength(1);
  });

  it('ends a list at the first line that is not a row, and does not read near-misses as rows', () => {
    expect(parseMarkdown('- a\nplain\n- b').map((b) => b.type)).toEqual(['list', 'paragraph', 'list']);
    expect(parseMarkdown('-item')).toEqual([{ type: 'paragraph', children: [text('-item')] }]);
    expect(parseMarkdown('-')).toEqual([{ type: 'paragraph', children: [text('-')] }]);
    expect(parseMarkdown('- ')).toEqual([{ type: 'paragraph', children: [text('- ')] }]);
    expect(parseMarkdown('1.5 is a number')).toEqual([{ type: 'paragraph', children: [text('1.5 is a number')] }]);
    expect(parseMarkdown('**bold** first')[0]).toMatchObject({ type: 'paragraph' });
    expect(parseMarkdown('-# small')[0]).toMatchObject({ type: 'subtext' });
  });

  it('leaves list marks inside quotes and code alone', () => {
    expect(parseMarkdown('> - not a list')[0]).toMatchObject({ type: 'quote' });
    expect(parseMarkdown('```\n- not a list\n```')).toEqual([{ type: 'code', lang: null, text: '- not a list' }]);
  });

  it('cuts very long text', () => {
    const long = 'a'.repeat(MAX_LENGTH + 500);
    const out = strings(parseMarkdown(long)).texts.join('');
    expect(out.length).toBe(MAX_LENGTH + 1);
    expect(out.endsWith('…')).toBe(true);
  });
});

describe('plain text', () => {
  it('drops the marks and the spoilers', () => {
    expect(plainText('**Result:** it *holds*, ||secret|| see [the table](https://example.com)')).toBe('Result: it holds, see the table');
    expect(plainText('# Title\n> quoted\n`code`')).toBe('Title quoted code');
    expect(plainText('**a ||nested secret|| b**')).toBe('a b');
    expect(plainText('- one **two**\n  - ||three||\n- four')).toBe('one two four');
  });
});

describe('hostile input', () => {
  const attacks = [
    '<script>alert(1)</script>',
    '<img src=x onerror=alert(1)>',
    '"><svg onload=alert(1)>',
    "'><iframe src=javascript:alert(1)>",
    '[click](javascript:alert(1))',
    '[click](JaVaScRiPt:alert(1))',
    '[click]( javascript:alert(1))',
    '[click](data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==)',
    '[click](vbscript:msgbox(1))',
    '[click](https://example.com" onmouseover="alert(1))',
    '[click](https://example.com/" onclick="alert(1))',
    '<javascript:alert(1)>',
    '<https://example.com" onfocus="alert(1)>',
    'https://example.com/"onmouseover="alert(1)',
    '[![x](https://example.com/a.png)](javascript:alert(1))',
    '**<script>alert(1)</script>**',
    '__<img src=x onerror=alert(1)>__',
    '||<script>alert(1)</script>||',
    '`<script>alert(1)</script>`',
    '```html\n<script>alert(1)</script>\n```',
    '> <script>alert(1)</script>',
    '# <script>alert(1)</script>',
    '-# <script>alert(1)</script>',
    '[<script>alert(1)</script>](https://example.com)',
    '[a](https://example.com)[b](javascript:alert(1))',
    '*[x](javascript:alert(1))*',
    '[[x](javascript:alert(1))](https://example.com)',
    '&lt;script&gt;alert(1)&lt;/script&gt;',
    '\\<script>alert(1)\\</script>',
    '\u0000<script>\u0000alert(1)',
    'https://user:pass@evil.example/',
    '[trusted.example](https://trusted.example@evil.example/)',
  ];

  it.each(attacks)('hands the page only text and safe addresses: %s', (attack) => {
    const { texts, hrefs, kinds } = strings(parseMarkdown(attack));
    // The tree has no node that could carry markup.
    for (const k of kinds)
      expect(['paragraph', 'heading', 'subtext', 'quote', 'code', 'text', 'bold', 'italic', 'underline', 'strike', 'spoiler', 'link']).toContain(k);
    // Every address is a plain web address the browser reads as http or https, with no user name and nothing smuggled in.
    for (const href of hrefs) {
      const url = new URL(href);
      expect(['http:', 'https:']).toContain(url.protocol);
      expect(url.username + url.password).toBe('');
      expect(href).not.toMatch(/["'<>\s]/);
    }
    // Markup the message contained is still in the text, as characters, never gone and never live.
    expect(texts.join('')).not.toBe('');
  });

  it('keeps hostile markup as visible text', () => {
    expect(para('<script>alert(1)</script>')).toEqual([text('<script>alert(1)</script>')]);
    expect(para('<img src=x onerror=alert(1)>')).toEqual([text('<img src=x onerror=alert(1)>')]);
    expect(para('[click](javascript:alert(1))')).toEqual([text('[click](javascript:alert(1))')]);
    expect(para('[click](data:text/html;base64,AAAA)')).toEqual([text('[click](data:text/html;base64,AAAA)')]);
  });

  it('never makes a link from a script address, however it is written', () => {
    for (const a of attacks) expect(strings(parseMarkdown(a)).hrefs.filter((h) => /^(javascript|data|vbscript):/i.test(h))).toEqual([]);
  });

  it('does not let an address carry attributes out of its link', () => {
    const [link] = para('[x](https://example.com/" onmouseover="alert(1))');
    // The quote and the space end up percent-encoded or the link is refused; either way no raw quote survives in href.
    if (link?.type === 'link') expect(link.href).not.toMatch(/"/);
    expect(strings(parseMarkdown('https://example.com/"onmouseover="alert(1)')).hrefs.every((h) => !h.includes('"'))).toBe(true);
  });

  it('shows the real host of a masked link', () => {
    const [link] = para('[trusted.example](https://trusted.example@evil.example/)');
    expect(link).toEqual(text('[trusted.example](https://trusted.example@evil.example/)'));
    const [ok] = para('[trusted.example](https://evil.example/login)');
    expect(ok).toMatchObject({ type: 'link', host: 'evil.example', masked: true });
  });

  it('handles nested and crossed markers without hanging', () => {
    const started = Date.now();
    for (const s of [
      '*'.repeat(8000),
      '_'.repeat(8000),
      '*a '.repeat(2600),
      '[**'.repeat(2600),
      '`'.repeat(8000),
      '||~~__**'.repeat(1000),
      '[a](b'.repeat(1600),
      '<'.repeat(8000),
      'https://'.repeat(1000),
      '> '.repeat(4000),
      '```'.repeat(2600),
    ]) {
      expect(() => parseMarkdown(s)).not.toThrow();
    }
    expect(Date.now() - started).toBeLessThan(5000);
  });

  it('keeps lists cheap and safe', () => {
    const started = Date.now();
    const many = parseMarkdown('- a\n'.repeat(5000));
    expect(many[0]).toMatchObject({ type: 'list' });
    parseMarkdown(`${' '.repeat(7000)}- x`);
    parseMarkdown(`- ${' '.repeat(7000)}`);
    parseMarkdown(Array.from({ length: 200 }, (_, i) => `${' '.repeat(i)}- row ${i}`).join('\n'));
    expect(Date.now() - started).toBeLessThan(5000);
    const { hrefs, texts } = strings(parseMarkdown('- [x](javascript:alert(1))\n  - <img src=x onerror=alert(1)>\n1. [ok](https://example.com)'));
    expect(hrefs).toEqual(['https://example.com/']);
    expect(texts.join(' ')).toContain('<img src=x onerror=alert(1)>');
  });

  it('survives lone surrogates and control characters', () => {
    expect(() => parseMarkdown('\ud800 **\u0000** \udc00 [x](https://exa\u0000mple.com)')).not.toThrow();
  });
});

describe('the samples on the fixture pages', () => {
  it('renders the formatting sample', () => {
    const blocks = parseMarkdown(
      '# Run 61 notes\n**Result:** the ranking *holds*, __even__ for ~~short~~ titles. See [the table](https://example.com/run-61).\n> Sample: 1,200 titles\n> ||Spanish and German move most||\n```py\nx = 1\n```\n-# Posted by Kestrel',
    );
    expect(blocks.map((b) => b.type)).toEqual(['heading', 'paragraph', 'quote', 'code', 'subtext']);
    const { kinds, hrefs } = strings(blocks);
    for (const k of ['bold', 'italic', 'underline', 'strike', 'spoiler', 'link']) expect(kinds.has(k), k).toBe(true);
    expect(hrefs).toEqual(['https://example.com/run-61']);
  });
});
