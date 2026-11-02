import type { Handle } from '@sveltejs/kit/hooks';
import { PATHS } from '#lib/fixtures/marketing/site.js';
import { markdownPath, movedDoc, pageOf } from '#lib/markdown-paths.js';
import { pageToMarkdown } from '#lib/server/markdown/convert.js';
import { wantsMarkdown } from '#lib/server/markdown/negotiate.js';
import { handWrittenMarkdown, needsSignIn, signInMarkdown } from '#lib/server/markdown/pages.js';
import { readSession } from '#lib/server/session.js';

const MARKDOWN = 'text/markdown; charset=utf-8';
/** What decides between a page's HTML and its Markdown, so caches keep both. */
const VARY = 'Accept, User-Agent';

/**
 * Every page has a Markdown version for agents (#24). A page answers with Markdown when it is fetched at its `.md` URL
 * (see `hooks.ts`), or when the request prefers Markdown or comes from an agent (see `negotiate.ts`). The page renders
 * as usual and its content is converted, unless it has hand-written Markdown. HTML responses advertise both.
 */
export const handle: Handle = async ({ event, resolve }) => {
  const { url, request } = event;
  const moved = movedDoc(url.pathname);
  if (moved) return new Response(null, { status: 308, headers: { location: moved + url.search } });
  event.locals.owner = await readSession(event.cookies);
  const page = pageOf(url.pathname);
  const negotiated = page === null && (request.method === 'GET' || request.method === 'HEAD') && !event.isDataRequest;

  if (page === null && !(negotiated && wantsMarkdown(request.headers))) {
    const response = await resolve(event);
    if (negotiated && isHtml(response)) {
      response.headers.append('vary', VARY);
      if (response.ok) {
        response.headers.append('link', `<${markdownPath(url.pathname)}>; rel="alternate"; type="text/markdown"`);
        response.headers.append('link', `<${PATHS.llmsTxt}>; rel="llms-txt"`);
      }
    }
    return response;
  }

  // Docs pages end in a slash; their Markdown, like every page's, is named without it.
  const path = page ?? (url.pathname.replace(/\/+$/, '') || '/');
  const headers = { 'content-type': MARKDOWN, ...(negotiated && { vary: VARY }) };

  const handWritten = await handWrittenMarkdown(path, new URL(path + url.search, url));
  if (handWritten !== undefined) return new Response(handWritten, { headers });
  if (needsSignIn(event.route.id) && !event.locals.owner) return new Response(signInMarkdown(url.origin, path), { headers });

  const response = await resolve(event);
  const location = response.headers.get('location');
  if (page !== null && location) {
    // Keep a redirected `.md` request on Markdown: /admin.md goes to /admin/moderation.md.
    const target = new URL(location, url);
    if (target.origin === url.origin) response.headers.set('location', markdownPath(target.pathname) + target.search);
    return response;
  }
  if (!isHtml(response)) return response;
  // Only docs pages link relatively, and each one renders at its path with a slash.
  const rendered = new URL(path === '/' ? path : `${path}/`, url);
  return new Response(pageToMarkdown(await response.text(), rendered), { status: response.status, headers });
};

const isHtml = (response: Response) => response.headers.get('content-type')?.startsWith('text/html') ?? false;
