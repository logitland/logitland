import { redirect } from '@sveltejs/kit';
import { pageOf } from '#lib/markdown-paths.js';
import { DOCS_BASE, docsFile } from '#lib/server/markdown/docs.js';

/** Svartz writes each docs page at `<path>/index.html`, and the static assets redirect to the slash; keep URLs as they come. */
export const trailingSlash = 'ignore';

/**
 * The docs site: apps/docs builds it and the web build copies it into the Worker's static assets under /docs. Its files
 * come through this route rather than straight from the assets (`run_worker_first` in wrangler.jsonc), so the hook can
 * answer agents with Markdown and `docsFile` can name this origin in them. An unknown path gets the docs' own 404 page.
 */
export async function GET({ url }) {
  // The assets answer `/docs` with the home page itself, whose relative links need the slash.
  if (url.pathname === DOCS_BASE) redirect(308, `${DOCS_BASE}/`);
  // A `.md` request lands here only for a page without a note (a folder listing); the hook converts its HTML. The request's
  // conditional headers stay behind, so a Markdown request never gets a 304 meant for the HTML.
  const page = pageOf(url.pathname);
  const asset = await docsFile(new URL(page === null ? url.pathname : `${page}/`, url));
  if (asset.status !== 404) return new Response(asset.body, asset);
  // The assets serve `404.html` at `/404`, like every HTML file without its extension.
  const notFound = await docsFile(new URL(`${DOCS_BASE}/404`, url));
  return new Response(notFound.body, { status: 404, headers: notFound.headers });
}
