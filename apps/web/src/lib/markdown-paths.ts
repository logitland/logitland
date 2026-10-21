/** Every page also answers as Markdown at its path plus `.md`; `/` answers at `/index.md`. */
export const markdownPath = (path: string) => `${path === '/' ? '/index' : path}.md`;

/** The page a `.md` path is the Markdown version of, or null for any other path. */
export function pageOf(path: string) {
  if (!path.endsWith('.md')) return null;
  return path === '/index.md' ? '/' : path.slice(0, -'.md'.length);
}
