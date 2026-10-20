// Fetches every page of the built web app the four ways an agent or browser can, and asserts what each gets (#24).
// Usage: build apps/web, serve it with `pnpm exec wrangler dev .svelte-kit/cloudflare/_worker.js --port 4291`, then
// BASE=http://127.0.0.1:4291 node check.mjs [--samples]
// --samples rewrites the Markdown samples next to this script.
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';

const BASE = process.env.BASE ?? 'http://127.0.0.1:4291';
const SAMPLES = new URL('./samples/', import.meta.url);
const writeSamples = process.argv.includes('--samples');

const CHROME = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36';
const BROWSER = { 'user-agent': CHROME, accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8' };
const SIGNED_IN = { cookie: 'session=u_ada' };

const MARKETING = ['/', '/sign-in'];
const OWNER = ['/agents', '/agents/adopt', '/agents/ag_q8w2', '/agents/ag_q8w2/subscriptions', '/agents/ag_q8w2/delivery', '/agents/ag_q8w2/level'];
const ADMIN = [
  '/admin/moderation',
  '/admin/moderation/reports',
  '/admin/moderation/appeals',
  '/admin/moderation/strikes',
  '/admin/agents',
  '/admin/agents/ag_m3th',
  '/admin/levels/0',
  '/admin/levels/defaults',
  '/admin/channels',
  '/admin/admins',
  '/admin/health',
  '/admin/audit',
];
const PAGES = [...MARKETING, ...OWNER, ...ADMIN];
const SAMPLED = ['/', '/sign-in', '/agents', '/agents/ag_q8w2/delivery', '/admin/moderation', '/admin/channels', '/admin/health'];

const markdownPath = (path) => `${path === '/' ? '/index' : path}.md`;
const step = (name) => console.log(`✓ ${name}`);
let checked = 0;

async function get(path, headers) {
  const response = await fetch(BASE + path, { headers });
  checked++;
  return { status: response.status, type: response.headers.get('content-type') ?? '', vary: response.headers.get('vary'), link: response.headers.get('link'), body: await response.text() };
}

function assertMarkdown(response, where) {
  assert.equal(response.status, 200, `${where}: status`);
  assert.match(response.type, /^text\/markdown/, `${where}: content type`);
  assert.ok(response.body.trim().length > 0, `${where}: empty Markdown`);
  assert.ok(!/<(html|body|div)\b/i.test(response.body), `${where}: HTML left in the Markdown`);
}

for (const path of PAGES) {
  const signedIn = !MARKETING.includes(path) ? SIGNED_IN : {};

  const html = await get(path, { ...BROWSER, ...signedIn });
  assert.equal(html.status, 200, `${path} as a browser: status`);
  assert.match(html.type, /^text\/html/, `${path} as a browser: content type`);
  assert.equal(html.vary, 'Accept, User-Agent', `${path} as a browser: Vary`);
  assert.ok(html.link?.includes(`<${markdownPath(path)}>; rel="alternate"; type="text/markdown"`), `${path}: Link to its Markdown`);
  assert.ok(html.link?.includes('</llms.txt>'), `${path}: Link to llms.txt`);

  const bot = await get(path, { 'user-agent': 'Mozilla/5.0 (compatible; ClaudeBot/1.0; +claudebot@anthropic.com)', accept: 'text/html', ...signedIn });
  assertMarkdown(bot, `${path} as ClaudeBot`);
  assert.equal(bot.vary, 'Accept, User-Agent', `${path} as ClaudeBot: Vary`);

  const accept = await get(path, { 'user-agent': CHROME, accept: 'text/markdown', ...signedIn });
  assertMarkdown(accept, `${path} with Accept: text/markdown`);

  const md = await get(markdownPath(path), { ...BROWSER, ...signedIn });
  assertMarkdown(md, `${markdownPath(path)} as a browser`);
  assert.equal(md.body, bot.body, `${path}: the .md URL and negotiation give the same Markdown`);

  if (!MARKETING.includes(path)) {
    const signedOut = await get(path, { 'user-agent': 'curl/8.9.1' });
    assertMarkdown(signedOut, `${path} signed out`);
    assert.match(signedOut.body, /^# Sign in/, `${path} signed out: says how to sign in`);
    assert.ok(signedOut.body.includes(`next=${encodeURIComponent(path)}`), `${path} signed out: returns to the page`);
    assert.doesNotMatch(bot.body, /^# Sign in/, `${path} signed in: renders the page, not the sign-in`);
  }

  if (writeSamples && SAMPLED.includes(path)) {
    mkdirSync(SAMPLES, { recursive: true });
    writeFileSync(new URL(markdownPath(path).slice(1).replaceAll('/', '_'), SAMPLES), md.body);
  }
  step(`${path}: HTML for browsers; Markdown for ClaudeBot, Accept and ${markdownPath(path)}`);
}

const llms = await get('/llms.txt', BROWSER);
assertMarkdown(llms, '/llms.txt');
for (const path of [...PAGES.filter((p) => !p.includes('ag_') && !/\/levels\/\d/.test(p)), '/agents/{id}', '/admin/agents/{id}', '/admin/levels/{level}']) {
  assert.ok(llms.body.includes(`${new URL(BASE).origin}${markdownPath(path)}`), `/llms.txt lists ${path}`);
}
if (writeSamples) writeFileSync(new URL('llms.txt', SAMPLES), llms.body);
step('/llms.txt lists every page by its Markdown URL, with request-origin links');

const redirect = await fetch(`${BASE}/admin.md`, { headers: SIGNED_IN, redirect: 'manual' });
assert.equal(redirect.headers.get('location'), '/admin/moderation.md', '/admin.md redirects to Markdown');
step('/admin.md redirects to /admin/moderation.md');

const owner = await fetch(`${BASE}/admin/health`, { headers: { 'user-agent': 'curl/8.9.1', cookie: 'session=u_kit' }, redirect: 'manual' });
assert.equal(owner.headers.get('location'), '/agents', 'an owner without admin standing goes to their agents');
step('an owner without admin standing is sent to /agents');

console.log(`\n${checked} responses checked against ${BASE}`);
