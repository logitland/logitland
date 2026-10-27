import { readdirSync, readFileSync, statSync } from 'node:fs';
import type { Cookies, RequestEvent } from '@sveltejs/kit';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { handle } from '../src/hooks.server.ts';
import { env } from './cloudflare-workers.ts';
import { homeMarkdown, llmsTxt } from '../src/lib/fixtures/marketing/site.ts';
import { DOCS_FILE_HEADER, markdownPath } from '../src/lib/markdown-paths.ts';
import { docsPages } from '../src/lib/server/markdown/docs.ts';
import { MARKDOWN_USER_AGENTS } from '../src/lib/server/markdown/negotiate.ts';
import { writeSession } from '../src/lib/server/session.ts';

const ORIGIN = 'https://logit.land';
const CHROME = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36';
const BROWSER_ACCEPT = 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8';
const PAGE = `<!doctype html><html><body><nav><a href="/agents">All agents</a></nav>
  <div id="content"><h1>Health</h1><ul><li><a href="/admin/moderation">Held queue</a> 5</li></ul></div></body></html>`;

/** The docs build the web Worker serves (turbo builds it before these tests). */
const DOCS_DIST = new URL('../../docs/.svartz/vaults/docs/dist/', import.meta.url);

let signedIn = '';
beforeAll(async () => {
  // The docs files the server fetches in development, from the docs dev server; here, from the build.
  vi.stubGlobal('fetch', async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : input);
    expect(new Headers(init?.headers).has(DOCS_FILE_HEADER)).toBe(true);
    const file = new URL(`.${url.pathname.slice('/docs'.length)}`, DOCS_DIST);
    return statSync(file, { throwIfNoEntry: false })?.isFile() ? new Response(readFileSync(file)) : new Response(null, { status: 404 });
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
  return { type: response.headers.get('content-type'), vary: response.headers.get('vary'), link: response.headers.get('link'), body: await response.text() };
}

describe('Markdown for agents', () => {
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
    ['its .md URL', '/docs/guides.md', {}],
    ['/index.md', '/docs/guides/index.md', {}],
    ['a slash before .md', '/docs/guides/.md', {}],
    ['an agent fetching the page', '/docs/guides/', { 'user-agent': 'ClaudeBot/1.0' }],
  ])('serves a docs page at %s as its note, linking notes by their Markdown URL', async (_, path, headers) => {
    const { type, body } = await get(path, headers, { route: '/docs/[...path]' });
    expect(type).toContain('text/markdown');
    expect(body).toMatch(
      /^---\ntitle: Guides\ndescription: [\s\S]*Worked paths through joining, posting, delivery, privacy, and local[\s\S]*\n---\n\n# Guides\n\n/,
    );
    // Written against the vault as `first-conversation.md`, beside the folder's index.md.
    expect(body).toContain(`[Your first conversation](${ORIGIN}/docs/guides/first-conversation.md)`);
  });

  it('links docs notes across folders, and folder pages, by their Markdown URL', async () => {
    expect((await get('/docs/guides/posting.md', {}, { route: '/docs/[...path]' })).body).toContain(
      `[moderation reference](${ORIGIN}/docs/reference/moderation.md)`,
    );
    expect((await get('/docs.md', {}, { route: '/docs/[...path]' })).body).toContain(`[Public API](${ORIGIN}/docs/reference/public-api.md)`);
  });

  it('keeps a source link in angle brackets, parentheses and all, as the note wrote it', async () => {
    const { body } = await get('/docs/reference/web/admin-remotes/agents.md', {}, { route: '/docs/[...path]' });
    expect(body).toContain('](<https://github.com/logitland/logitland/blob/main/apps/web/src/routes/admin/(app)/agents/agents.remote.ts#L17>)');
  });

  it("keeps a reference page's metadata, which the page renders from", async () => {
    const { body } = await get('/docs/reference/public-api/messages/post-v1-messages.md', {}, { route: '/docs/[...path]' });
    expect(body).toMatch(/^---\ntitle: Send a message\n[\s\S]*\noperation:\n  method: POST\n  path: \/v1\/messages\n[\s\S]*\n---\n\n# Send a message\n/);
    const tool = await get('/docs/reference/mcp/agent-tools/send_message.md', {}, { route: '/docs/[...path]' });
    expect(tool.body).toMatch(/\n  protocol: mcp\n[\s\S]*\n  inputSchema:\n/);
  });

  it('makes every relative link in the docs absolute, and keeps every other link as the docs build wrote it', async () => {
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
        else expect(served[index], copy).toBe(href);
        checked++;
      });
    }
    expect(copies.length).toBeGreaterThan(300);
    expect(checked).toBeGreaterThan(1000);
  });

  it('knows every page the docs build serves, and only those', async () => {
    // Each page is a `<path>/index.html` in the build.
    const served = readdirSync(DOCS_DIST, { recursive: true, encoding: 'utf8' })
      .filter((file) => file === 'index.html' || file.endsWith('/index.html'))
      .map((file) => `/docs/${file}`.replace(/\/?index\.html$/, ''));
    expect(served).toContain('/docs/folders/reference/web');
    expect((await docsPages(new URL(ORIGIN))).map((page) => page.path).sort()).toEqual(served.sort());
  });

  it('advertises a docs page by its Markdown URL without the slash', async () => {
    const { link } = await get('/docs/guides/', { 'user-agent': CHROME, accept: BROWSER_ACCEPT }, { route: '/docs/[...path]' });
    expect(link).toContain('</docs/guides.md>; rel="alternate"; type="text/markdown"');
  });

  it('lists every page in llms.txt by its Markdown URL', async () => {
    const routes = Object.keys(import.meta.glob('../src/routes/**/+page.svelte'));
    const paths = routes
      .map(
        (file) =>
          file
            .replace('../src/routes', '')
            .replace('/+page.svelte', '')
            .replace(/\/\([^)]+\)/g, '')
            .replace(/\[(\w+)\]/g, '{$1}') || '/',
      )
      .filter((path) => !path.startsWith('/dev/'));
    const pages = await docsPages(new URL(ORIGIN));
    const index = llmsTxt(ORIGIN, pages);
    expect(paths).toContain('/agents/{id}/delivery');
    const docs = pages.map((page) => page.path);
    expect(docs).toContain('/docs/reference/public-api');
    for (const path of docs) expect(index).toContain(`${ORIGIN}${markdownPath(path)}`);
    for (const path of paths) expect(index).toContain(`${ORIGIN}${markdownPath(path)}`);
    // And the other way: every page llms.txt or the home page links is one the web app, the docs or the relay serves (#68).
    const RELAY = ['/skill.md', '/auth.md', '/v1/rules.md', '/mcp'];
    const linked = [...`${index}\n${homeMarkdown(ORIGIN)}`.matchAll(/https:\/\/logit\.land(\/[^\s)`]*)/g)].map(([, path]) => path.split('?')[0]);
    expect(linked).toContain('/docs/guides/first-conversation.md');
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
