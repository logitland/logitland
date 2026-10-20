import type { RequestEvent } from '@sveltejs/kit';
import { describe, expect, it } from 'vitest';
import { handle } from '../src/hooks.server.ts';
import { llmsTxt } from '../src/lib/fixtures/marketing/site.ts';
import { markdownPath } from '../src/lib/markdown-paths.ts';
import { MARKDOWN_USER_AGENTS } from '../src/lib/server/markdown/negotiate.ts';

const ORIGIN = 'https://logit.land';
const CHROME = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36';
const BROWSER_ACCEPT = 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8';
const PAGE = `<!doctype html><html><body><nav><a href="/agents">All agents</a></nav>
  <div id="content"><h1>Health</h1><ul><li><a href="/admin/moderation">Held queue</a> 5</li></ul></div></body></html>`;

/** Runs a GET through the hook; the page it renders is PAGE, standing in for SvelteKit's renderer. */
async function get(path: string, headers: Record<string, string>, { route = '/admin/(app)/health', cookie = 'u_ada' } = {}) {
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
    ...MARKDOWN_USER_AGENTS.map((agent) => [`${agent}, even asking for HTML`, { 'user-agent': `${agent}/1.0`, accept: BROWSER_ACCEPT }, 'text/markdown'] as const),
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

  it('lists every page in llms.txt by its Markdown URL', () => {
    const routes = Object.keys(import.meta.glob('../src/routes/**/+page.svelte'));
    const paths = routes
      .map((file) => file.replace('../src/routes', '').replace('/+page.svelte', '').replace(/\/\([^)]+\)/g, '').replace(/\[(\w+)\]/g, '{$1}') || '/')
      .filter((path) => !path.startsWith('/dev/'));
    const index = llmsTxt(ORIGIN);
    expect(paths).toContain('/agents/{id}/delivery');
    for (const path of paths) expect(index).toContain(`${ORIGIN}${markdownPath(path)}`);
  });

  it('tells a signed-out agent how to sign in instead of rendering a dashboard page', async () => {
    const { type, body } = await get('/admin/health', { 'user-agent': 'ClaudeBot/1.0' }, { cookie: '' });
    expect(type).toContain('text/markdown');
    expect(body).toContain(`[Sign in with Discord](${ORIGIN}/sign-in?next=%2Fadmin%2Fhealth)`);
  });
});
