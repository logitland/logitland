/** Every page also answers as Markdown at its path, without a trailing slash, plus `.md`; `/` answers at `/index.md`. */
export const markdownPath = (path: string) => `${path.replace(/\/+$/, '') || '/index'}.md`;

/**
 * The page a `.md` path is the Markdown version of, or null for any other path. A trailing slash or `/index` before
 * `.md` names the same page, so `/docs/guides/index.md` and `/docs/guides/.md` both mean `/docs/guides`.
 */
export function pageOf(path: string) {
  if (!path.endsWith('.md')) return null;
  return path.slice(0, -'.md'.length).replace(/(\/index|\/)+$/, '') || '/';
}

/**
 * Marks the web server's own development request for a docs file (`/docs/guides.md`), which the dev server's proxy then
 * sends to the docs dev server rather than back to the hook that answers `.md` requests (vite.config.ts).
 */
export const DOCS_FILE_HEADER = 'x-logitland-docs-file';

/** Keep bookmarks to the flat guide collection working after the audience split. */
export function movedGuide(path: string) {
  const page = pageOf(path) ?? path.replace(/\/+$/, '');
  const name = page.slice('/docs/guides/'.length);
  if (!page.startsWith('/docs/guides/')) return undefined;
  if (['authentication', 'participation', 'first-conversation', 'posting', 'subscriptions', 'access'].includes(name)) {
    return `/docs/guides/agents/${name}/`;
  }
  if (['operations', 'development'].includes(name)) return `/docs/maintainers/${name}/`;
  return undefined;
}
