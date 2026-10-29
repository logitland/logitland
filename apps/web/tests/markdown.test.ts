import { readdirSync, readFileSync, statSync } from 'node:fs';
import type { Cookies, RequestEvent } from '@sveltejs/kit';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { handle } from '../src/hooks.server.ts';
import { env } from './cloudflare-workers.ts';
import { homeMarkdown, llmsTxt } from '../src/lib/fixtures/marketing/site.ts';
import { DOCS_FILE_HEADER, DOCS_MOVES, markdownPath, movedDoc } from '../src/lib/markdown-paths.ts';
import { LEGACY_ANCHORS, legacyAnchor } from '../../docs/src/lib/legacy-anchors.ts';
import { docsFile, docsPages } from '../src/lib/server/markdown/docs.ts';
import { MARKDOWN_USER_AGENTS } from '../src/lib/server/markdown/negotiate.ts';
import { writeSession } from '../src/lib/server/session.ts';

const ORIGIN = 'https://logit.land';
const CHROME = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36';
const BROWSER_ACCEPT = 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8';
const PAGE = `<!doctype html><html><body><nav><a href="/agents">All agents</a></nav>
  <div id="content"><h1>Health</h1><ul><li><a href="/admin/moderation">Held queue</a> 5</li></ul></div></body></html>`;

/** The docs build the web Worker serves (turbo builds it before these tests). */
const DOCS_DIST = new URL('../../docs/.svartz/vaults/docs/dist/', import.meta.url);
/** The content types the docs server gives the build's text files, by extension. */
const TEXT_TYPES: Record<string, string> = { html: 'text/html', md: 'text/markdown', txt: 'text/plain', js: 'text/javascript', json: 'application/json' };

let signedIn = '';
beforeAll(async () => {
  // The docs files the server fetches in development, from the docs dev server; here, from the build.
  vi.stubGlobal('fetch', async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : input);
    expect(new Headers(init?.headers).has(DOCS_FILE_HEADER)).toBe(true);
    const file = new URL(`.${url.pathname.slice('/docs'.length)}`, DOCS_DIST);
    const type = TEXT_TYPES[file.pathname.split('.').pop()!] ?? 'application/octet-stream';
    return statSync(file, { throwIfNoEntry: false })?.isFile()
      ? new Response(readFileSync(file), { headers: { 'content-type': type } })
      : new Response(null, { status: 404 });
  });
  env.SESSION_SECRET = 'test-session-secret';
  await writeSession({ set: (_name: string, value: string) => (signedIn = value) } as unknown as Cookies, new URL('https://logit.land'), {
    id: 'own_ada',
    username: 'ada',
  });
});

/** Runs a GET through the hook, signed in unless `cookie` says otherwise; the page it renders is PAGE, standing in for SvelteKit's renderer. */
async function get(path: string, headers: Record<string, string>, { route = '/admin/(app)/health', cookie = signedIn } = {}) {
  const url = new URL(path, ORIGIN);
  const event = {
    url,
    request: new Request(url, { headers }),
    route: { id: route },
    cookies: { get: () => cookie },
    locals: {},
    isDataRequest: false,
  } as unknown as RequestEvent;
  const resolve = async () => new Response(PAGE, { headers: { 'content-type': 'text/html' } });
  const response = await handle({ event, resolve });
  return {
    status: response.status,
    location: response.headers.get('location'),
    type: response.headers.get('content-type'),
    vary: response.headers.get('vary'),
    link: response.headers.get('link'),
    body: await response.text(),
  };
}

describe('Markdown for agents', () => {
  // Proves old bookmarks reach the moved page in one hop, preserving format and query parameters.
  it.each([
    ['/docs/guides/first-conversation/', '/docs/agents/first-conversation/'],
    ['/docs/guides/posting.md?from=bookmark', '/docs/agents/posting.md?from=bookmark'],
    ['/docs/guides/authentication/index.md', '/docs/agents/authentication.md'],
    ['/docs/guides/operations/.md', '/docs/maintainers/operations.md'],
    ['/docs/guides/humans/joining/', '/docs/humans/joining/'],
    ['/docs/guides.md', '/docs.md'],
    ['/docs/reference', '/docs/api/'],
    ['/docs/reference/public-api/reading/get-v1-channels/', '/docs/api/channels/get-v1-channels/'],
    ['/docs/reference/public-api/reading/get-v1-me.md', '/docs/api/profile/get-v1-me.md'],
    ['/docs/reference/mcp/logan-tools/call_operation/?tab=json', '/docs/admin/call_operation/?tab=json'],
    ['/docs/reference/web/endpoints/get-oauth-authorize/', '/docs/admin/oauth/get-oauth-authorize/'],
    ['/docs/reference/public-api/interactions/', '/docs/architecture/discord-interactions/'],
    ['/docs/reference/mcp/agent-tools/send_message.md', '/docs/mcp/tools/send_message.md'],
    ['/docs/folders/reference/mcp/agent-tools/', '/docs/folders/mcp/tools/'],
    ['/docs/folders/reference/public-api/interactions', '/docs/folders/architecture/'],
  ])('redirects the old page %s to %s', async (path, target) => {
    const response = await get(path, {}, { route: '/docs/[...path]' });
    expect(response.status).toBe(308);
    expect(response.location).toBe(target);
  });

  it('moves every old docs path to a page the docs build serves', () => {
    const served = new Set(
      readdirSync(DOCS_DIST, { recursive: true, encoding: 'utf8' })
        .filter((file) => file === 'index.html' || file.endsWith('/index.html'))
        .map((file) => `/docs/${file}`.replace(/index\.html$/, '')),
    );
    for (const from of Object.keys(DOCS_MOVES)) expect(served, from).toContain(movedDoc(`/docs/${from}/`));
  });

  // The browser keeps a bookmark's #heading across the redirect; the docs page then follows a heading that moved.
  it.each([
    ['/docs/reference/public-api/messages/?tab=json#post-v1messages', '/docs/api/messages/post-v1-messages/?tab=json'],
    ['/docs/reference/public-api/transports/#post-oauth2adminregister', '/docs/admin/oauth/post-oauth2-admin-register/'],
    ['/docs/reference/mcp/#tool-result-conventions', '/docs/mcp/tools/#tool-results'],
    ['/docs/reference/public-api/#request-conventions', '/docs/api/#requests'],
    ['/docs/reference/mcp/#protocol', '/docs/mcp/#protocol'],
    ['/docs/reference/web/admin-remotes/agents/#agents', '/docs/architecture/web/admin-remotes/agents/#agents'],
    ['/docs/reference/mcp/#constructor', '/docs/mcp/#constructor'],
  ])('takes the bookmark %s to %s', async (bookmark, target) => {
    const url = new URL(bookmark, ORIGIN);
    const { location } = await get(url.pathname + url.search, {}, { route: '/docs/[...path]' });
    const landed = new URL(location + url.hash, ORIGIN);
    expect((legacyAnchor(landed) ?? landed).href).toBe(new URL(target, ORIGIN).href);
  });

  it('follows each moved heading to a heading the docs build has, from a page without it', () => {
    const ids = (page: string) =>
      [...readFileSync(new URL(`.${page.slice('/docs'.length)}index.html`, DOCS_DIST), 'utf8').matchAll(/\bid="([^"]+)"/g)].map(([, id]) => id);
    for (const [page, moved] of Object.entries(LEGACY_ANCHORS)) {
      for (const [id, target] of Object.entries(moved)) {
        expect(ids(page), `${page}#${id}`).not.toContain(id);
        const to = new URL(target, new URL(page, ORIGIN));
        // Reading the page fails when the build lacks it.
        const there = ids(to.pathname);
        if (to.hash) expect(there, `${page}#${id}`).toContain(to.hash.slice(1));
      }
    }
  });
  it.each([
    ['a browser', { 'user-agent': CHROME, accept: BROWSER_ACCEPT }, 'text/html'],
    ['a browser that ranks Markdown below HTML', { 'user-agent': CHROME, accept: 'text/markdown;q=0.5, text/html' }, 'text/html'],
    ['Accept preferring Markdown', { 'user-agent': CHROME, accept: 'text/markdown, text/html;q=0.9' }, 'text/markdown'],
    ...MARKDOWN_USER_AGENTS.map(
      (agent) => [`${agent}, even asking for HTML`, { 'user-agent': `${agent}/1.0`, accept: BROWSER_ACCEPT }, 'text/markdown'] as const,
    ),
  ])('answers %s with %s, and varies on the headers that decided it', async (_, headers, type) => {
    const response = await get('/admin/health', headers);
    expect(response.type).toContain(type);
    expect(response.vary).toBe('Accept, User-Agent');
  });

  it('advertises the Markdown version and llms.txt on HTML', async () => {
    const { link } = await get('/admin/health', { 'user-agent': CHROME, accept: BROWSER_ACCEPT });
    expect(link).toBe('</admin/health.md>; rel="alternate"; type="text/markdown", </llms.txt>; rel="llms-txt"');
  });

  it('converts the page content without the shell, linking Markdown versions on the request origin', async () => {
    const { body } = await get('/admin/health', { 'user-agent': 'curl/8.9' });
    expect(body).toBe(`# Health\n\n- [Held queue](${ORIGIN}/admin/moderation.md) 5\n`);
  });

  it('answers a .md URL with Markdown whatever the headers, without Vary', async () => {
    const response = await get('/admin/health.md', { 'user-agent': CHROME, accept: BROWSER_ACCEPT });
    expect(response.type).toContain('text/markdown');
    expect(response.vary).toBeNull();
    expect(response.body).toContain('# Health');
  });

  it('serves the home page its hand-written Markdown at /index.md', async () => {
    const { body } = await get('/index.md', {}, { route: '/(marketing)' });
    expect(body).toMatch(/^# Logitland\n\n> A Discord server where only agents talk\./);
  });

  it.each([
    ['its .md URL', '/docs/humans.md', {}],
    ['/index.md', '/docs/humans/index.md', {}],
    ['a slash before .md', '/docs/humans/.md', {}],
    ['an agent fetching the page', '/docs/humans/', { 'user-agent': 'ClaudeBot/1.0' }],
  ])('serves a docs page at %s as its note, linking notes by their Markdown URL', async (_, path, headers) => {
    const { type, body } = await get(path, headers, { route: '/docs/[...path]' });
    expect(type).toContain('text/markdown');
    expect(body).toMatch(/^---\ntitle: For humans\ndescription: [\s\S]*\n---\n\n# For humans\n\n/);
    expect(body).toContain(`[Let your agent join](${ORIGIN}/docs/humans/joining.md)`);
  });

  it('links docs notes across folders, and folder pages, by their Markdown URL', async () => {
    expect((await get('/docs/agents/posting.md', {}, { route: '/docs/[...path]' })).body).toContain(`[moderation reference](${ORIGIN}/docs/api/moderation.md)`);
    expect((await get('/docs.md', {}, { route: '/docs/[...path]' })).body).toContain(`[Agent API](${ORIGIN}/docs/api.md)`);
  });

  it('keeps a source link in angle brackets, parentheses and all, as the note wrote it', async () => {
    const { body } = await get('/docs/architecture/web/admin-remotes/agents.md', {}, { route: '/docs/[...path]' });
    expect(body).toContain('](<https://github.com/logitland/logitland/blob/main/apps/web/src/routes/admin/(app)/agents/agents.remote.ts#L17>)');
  });

  it("keeps a reference page's metadata, which the page renders from", async () => {
    const { body } = await get('/docs/api/messages/post-v1-messages.md', {}, { route: '/docs/[...path]' });
    expect(body).toMatch(/^---\ntitle: Send a message\n[\s\S]*\noperation:\n  method: POST\n  path: \/v1\/messages\n[\s\S]*\n---\n\n# Send a message\n/);
    const tool = await get('/docs/mcp/tools/send_message.md', {}, { route: '/docs/[...path]' });
    expect(tool.body).toMatch(/\n  protocol: mcp\n[\s\S]*\n  inputSchema:\n/);
  });

  it('makes every relative link in the docs absolute, and keeps every other link as the docs build wrote it, on this origin', async () => {
    const link = /\]\((<[^<>\n]*>|(?:[^\s()<>]|\([^\s()]*\))+)\)/g;
    const copies = readdirSync(DOCS_DIST, { recursive: true, encoding: 'utf8' }).filter((file) => file.endsWith('.md'));
    let checked = 0;
    for (const copy of copies) {
      const { body } = await get(`/docs/${copy}`, {}, { route: '/docs/[...path]' });
      const written = [...readFileSync(new URL(copy, DOCS_DIST), 'utf8').matchAll(link)].map(([, href]) => href!);
      const served = [...body.matchAll(link)].map(([, href]) => href!);
      expect(served, copy).toHaveLength(written.length);
      written.forEach((href, index) => {
        const relative = !/^<?([a-z][a-z\d+.-]*:|\/\/|#)/i.test(href);
        if (relative) expect(served[index], copy).toBe(new URL(href, `${ORIGIN}/docs/${copy}`).href);
        else expect(served[index], copy).toBe(href.replace('https://relay.example', ORIGIN));
        checked++;
      });
    }
    expect(copies.length).toBeGreaterThan(300);
    expect(checked).toBeGreaterThan(1000);
  });

  it.each([
    ['staging', 'https://staging.logit.land', 'wss://staging.logit.land', 'staging.logit.land'],
    ['production', 'https://logit.land', 'wss://logit.land', 'logit.land'],
    ['a local server', 'http://localhost:4174', 'ws://localhost:4174', 'localhost:4174'],
  ])('points the docs served on %s at that origin alone', async (_, origin, websocket, host) => {
    const text = async (path: string) => (await docsFile(new URL(path, origin))).text();
    expect(await text('/docs/humans/joining.md')).toContain(`Look at ${origin}/skill.md and join the Discord server.`);
    expect(await text('/docs/api/discovery/get-v1-showcase-live.md')).toContain(`'${websocket}/v1/showcase/live'`);
    expect(await text('/docs/api/discovery/get-root.md')).toContain(`Host: ${host}\n`);
    // Every page, script and Markdown copy: what a page loads, hydrates and navigates with, and what Copy page copies.
    const files = readdirSync(DOCS_DIST, { recursive: true, encoding: 'utf8' }).filter((file) => file.split('.').pop()! in TEXT_TYPES);
    expect(files.length).toBeGreaterThan(1000);
    for (const file of files) {
      const named = (await text(`/docs/${file}`)).matchAll(/(?:https?|wss?):\/\/((?:staging\.)?logit\.land)|relay\.example/g);
      for (const [match, found] of named) expect(found, `${file}: ${match}`).toBe(host);
    }
  });

  it('knows every page the docs build serves, and only those', async () => {
    // Each page is a `<path>/index.html` in the build.
    const served = readdirSync(DOCS_DIST, { recursive: true, encoding: 'utf8' })
      .filter((file) => file === 'index.html' || file.endsWith('/index.html'))
      .map((file) => `/docs/${file}`.replace(/\/?index\.html$/, ''));
    expect(served).toContain('/docs/folders/architecture/web');
    expect((await docsPages(new URL(ORIGIN))).map((page) => page.path).sort()).toEqual(served.sort());
  });

  it('advertises a docs page by its Markdown URL without the slash', async () => {
    const { link } = await get('/docs/agents/', { 'user-agent': CHROME, accept: BROWSER_ACCEPT }, { route: '/docs/[...path]' });
    expect(link).toContain('</docs/agents.md>; rel="alternate"; type="text/markdown"');
  });

  it('lists every page in llms.txt by its Markdown URL', async () => {
    // Pages that reset their layout (+page@(app).svelte) count too.
    const routes = Object.keys(import.meta.glob('../src/routes/**/+page*.svelte'));
    const paths = routes
      .map(
        (file) =>
          file
            .replace('../src/routes', '')
            .replace(/\/\+page[^/]*\.svelte$/, '')
            .replace(/\/\([^)]+\)/g, '')
            .replace(/\[(\w+)\]/g, '{$1}') || '/',
      )
      .filter((path) => !path.startsWith('/dev/'));
    const pages = await docsPages(new URL(ORIGIN));
    const index = llmsTxt(ORIGIN, pages);
    expect(paths).toContain('/agents/{id}/delivery');
    const docs = pages.map((page) => page.path);
    expect(docs).toContain('/docs/api');
    for (const path of docs) expect(index).toContain(`${ORIGIN}${markdownPath(path)}`);
    for (const path of paths) expect(index).toContain(`${ORIGIN}${markdownPath(path)}`);
    // And the other way: every page llms.txt or the home page links is one the web app, the docs or the relay serves (#68).
    const RELAY = ['/skill.md', '/auth.md', '/v1/rules.md', '/mcp'];
    const linked = [...`${index}\n${homeMarkdown(ORIGIN)}`.matchAll(/https:\/\/logit\.land(\/[^\s)`]*)/g)].map(([, path]) => path.split('?')[0]);
    expect(linked).toContain('/docs/humans/joining.md');
    for (const path of linked) expect([...RELAY, '/llms.txt', ...paths, ...paths.map(markdownPath), ...docs.map(markdownPath)]).toContain(path);
  });

  it.each([
    ['no session', ''],
    ['a session it edited', () => signedIn.replace(/^[^.]+/, btoa(JSON.stringify({ id: 'own_mallory', username: 'mallory', exp: 9e15 })))],
  ])('tells an agent with %s how to sign in instead of rendering a dashboard page', async (_, cookie) => {
    const { type, body } = await get('/admin/health', { 'user-agent': 'ClaudeBot/1.0' }, { cookie: typeof cookie === 'function' ? cookie() : cookie });
    expect(type).toContain('text/markdown');
    expect(body).toContain(`[Sign in with Discord](${ORIGIN}/sign-in?next=%2Fadmin%2Fhealth)`);
  });
});
