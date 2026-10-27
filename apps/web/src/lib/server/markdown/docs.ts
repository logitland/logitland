import { dev } from '$app/env';
import { env } from 'cloudflare:workers';
import { DOCS_FILE_HEADER, pageOf } from '#lib/markdown-paths.js';

/** Where the docs site (apps/docs) is mounted; its `paths.base` is the same. */
export const DOCS_BASE = '/docs';

/**
 * A file of the docs build, at `target`'s path: built, from this Worker's assets (the web build copies the docs there);
 * in development, from the docs dev server, which this server's proxy reaches for requests with the header.
 */
export const docsFile = (target: URL) => (dev ? fetch(target, { headers: { [DOCS_FILE_HEADER]: '1' } }) : env.ASSETS.fetch(target));

/** The Markdown copy the docs build writes for the note at a page path: `/docs/index.md` for the home page. */
const copyOf = (path: string) => (path === DOCS_BASE ? `${DOCS_BASE}/index.md` : `${path}.md`);

/** A link that leaves the docs or stays on the page: a scheme, a protocol-relative URL or a fragment. */
const NOT_RELATIVE = /^([a-z][a-z\d+.-]*:|\/\/|#)/i;

/**
 * A link's destination, after `](`: in angle brackets (`<…/(app)/x.ts>`, as the source links write paths with
 * parentheses), or bare, where parentheses must balance. Captured as the bracketed form and the URL inside it.
 */
const DESTINATION = /\]\((<([^<>\n]*)>|((?:[^\s()<>]|\([^\s()]*\))+))/g;

/**
 * The docs page at `path` as Markdown, or undefined when no note renders there (a folder listing, an unknown path).
 * It is the copy the docs build writes beside the page, frontmatter and all, so agents read the same operation, tool and
 * schema metadata as the page shows. Svartz links notes by relative paths to their copies; those become absolute on
 * `url`'s origin, so the Markdown reads the same at any URL.
 */
export async function docsMarkdown(path: string, url: URL) {
  if (path !== DOCS_BASE && !path.startsWith(`${DOCS_BASE}/`)) return undefined;
  const file = new URL(copyOf(path), url);
  const response = await docsFile(file);
  if (!response.ok) return undefined;
  return (await response.text()).replace(DESTINATION, (link, _, angled: string | undefined, bare: string | undefined) => {
    const href = angled ?? bare ?? '';
    if (NOT_RELATIVE.test(href)) return link;
    const target = new URL(href, file).href;
    return angled === undefined ? `](${target}` : `](<${target}>`;
  });
}

/** A page of the docs build's own llms.txt: `- [Title](relative/path.md): description`. */
const LLMS_PAGE = /^- \[(.+)\]\((\S+\.md)\)(?:: (.*))?$/gm;

/**
 * Every docs page, by page path, for llms.txt: the notes the docs build lists in its own `/docs/llms.txt`, then the
 * listings Svartz generates beside them (recent notes, the tag index, and a listing of the notes in each folder). Listings
 * have no note, so their Markdown is the converted page. A note with tags would add a page per tag; the vault uses none.
 */
export async function docsPages(url: URL) {
  const index = new URL(`${DOCS_BASE}/llms.txt`, url);
  const response = await docsFile(index);
  if (!response.ok) throw new Error(`The docs build has no llms.txt: ${response.status}`);
  const notes = [...(await response.text()).matchAll(LLMS_PAGE)].map(([, title = '', href = '', description = '']) => ({
    path: pageOf(new URL(href, index).pathname) ?? DOCS_BASE,
    title,
    description,
  }));
  const titles = new Map(notes.map((note) => [note.path, note.title]));
  // Every folder above a note, as a path below the docs: `reference`, `reference/web`.
  const folders = [
    ...new Set(
      notes.flatMap(({ path }) => {
        const dirs = path
          .slice(DOCS_BASE.length + 1)
          .split('/')
          .slice(0, -1);
        return dirs.map((_, depth) => dirs.slice(0, depth + 1).join('/'));
      }),
    ),
  ].sort();
  return [
    ...notes.sort((a, b) => a.path.localeCompare(b.path)),
    { path: `${DOCS_BASE}/feed`, title: 'Recently updated', description: 'The latest notes.' },
    { path: `${DOCS_BASE}/tags`, title: 'Tags', description: 'Every tag the notes use.' },
    { path: `${DOCS_BASE}/folders`, title: 'Reference', description: 'Every schema, operation, and tool.' },
    ...folders.map((folder) => ({
      path: `${DOCS_BASE}/folders/${folder}`,
      title: `Folder: ${titles.get(`${DOCS_BASE}/${folder}`) ?? folder}`,
      description: `The notes in \`${folder}/\`.`,
    })),
  ];
}
