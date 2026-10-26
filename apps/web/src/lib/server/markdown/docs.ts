import { markdownPath, pageOf } from '#lib/markdown-paths.js';

/** Where the docs site (apps/docs) is mounted; its `paths.base` is the same. */
export const DOCS_BASE = '/docs';

/** The docs vault's notes, by their path in the vault. Svartz renders each at its path without `.md`, `index` dropped. */
const sources = import.meta.glob<string>('../../../../../docs/vault/**/*.md', { query: '?raw', import: 'default', eager: true });

const FRONTMATTER = /^---\n([\s\S]*?)\n---\n+/;

/** A note's frontmatter fields (only flat `key: value` lines; the vault uses `title` and `description`) and its body. */
function parse(source: string) {
  const [block = '', fields = ''] = source.match(FRONTMATTER) ?? [];
  const meta = Object.fromEntries([...fields.matchAll(/^(\w+):\s*(['"]?)(.*)\2$/gm)].map(([, key, , value]) => [key, value]));
  return { title: meta.title ?? '', description: meta.description ?? '', body: source.slice(block.length) };
}

/** Every docs page with a note, by page path (`/docs/guides`, never a trailing slash). */
const NOTES = Object.entries(sources)
  .map(([key, source]) => {
    const file = key.slice(key.indexOf('/vault/') + '/vault/'.length);
    return { path: pageOf(`${DOCS_BASE}/${file}`) ?? DOCS_BASE, file, ...parse(source) };
  })
  .sort((a, b) => a.path.localeCompare(b.path));

const byPath = new Map(NOTES.map((page) => [page.path, page]));

/** The vault's folders (`reference`, `reference/web`): every folder above a note. */
const FOLDERS = [
  ...new Set(
    NOTES.flatMap(({ file }) => {
      const dirs = file.split('/').slice(0, -1);
      return dirs.map((_, depth) => dirs.slice(0, depth + 1).join('/'));
    }),
  ),
].sort();

/**
 * Every docs page, by page path, for llms.txt: the notes, then the listings Svartz generates beside them (recent notes,
 * the tag index, and a listing of the notes in each folder). Listings have no note, so their Markdown is the converted
 * page. A note with tags would add a page per tag; the vault uses none.
 */
export const DOCS_PAGES = [
  ...NOTES,
  { path: `${DOCS_BASE}/feed`, title: 'Recent notes', description: 'The latest notes.' },
  { path: `${DOCS_BASE}/tags`, title: 'Tags', description: 'Every tag the notes use.' },
  { path: `${DOCS_BASE}/folders`, title: 'Folders', description: 'Every folder of notes.' },
  ...FOLDERS.map((folder) => ({
    path: `${DOCS_BASE}/folders/${folder}`,
    title: `Folder: ${byPath.get(`${DOCS_BASE}/${folder}`)?.title ?? folder}`,
    description: `The notes in \`${folder}/\`.`,
  })),
];

/** A link that leaves the vault or stays on the page: a scheme, a protocol-relative URL or a fragment. */
const NOT_RELATIVE = /^([a-z][a-z\d+.-]*:|\/\/|#)/i;

/**
 * A link's destination, after `](`: in angle brackets (`<…/(app)/x.ts>`, as the source links write paths with
 * parentheses), or bare, where parentheses must balance. Captured as the bracketed form and the URL inside it.
 */
const DESTINATION = /\]\((<([^<>\n]*)>|((?:[^\s()<>]|\([^\s()]*\))+))/g;

/**
 * The docs page at `path` as its own Markdown source, or undefined when no note renders there. The heading and summary
 * come from the frontmatter; relative links, written against the vault (`../reference/public-api/index.md#errors`),
 * become absolute links to the pages' Markdown on `origin`.
 */
export function docsMarkdown(path: string, origin: string) {
  const page = byPath.get(path);
  if (!page) return undefined;
  const file = new URL(`${DOCS_BASE}/${page.file}`, origin);
  const body = page.body.replace(DESTINATION, (link, _, angled: string | undefined, bare: string | undefined) => {
    const href = angled ?? bare ?? '';
    if (NOT_RELATIVE.test(href)) return link;
    const target = new URL(href, file);
    const note = pageOf(target.pathname);
    if (note) target.pathname = markdownPath(note);
    return angled === undefined ? `](${target.href}` : `](<${target.href}>`;
  });
  return `# ${page.title}\n\n${page.description ? `> ${page.description}\n\n` : ''}${body.trim()}\n`;
}
