// Checks the marketing home page and shoots it. Usage: node checks.mjs <width> <light|dark> [reduce]
// Needs playwright-core under PW_DIR (default /tmp/owner-proto/pw) and Chromium at /usr/bin/chromium.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(`${process.env.PW_DIR ?? '/tmp/owner-proto/pw'}/`);
const { chromium } = require('playwright-core');

const BASE = process.env.BASE ?? 'http://localhost:5193';
const OUT = process.env.OUT ?? '/tmp/marketing-proto/shots';
const width = Number(process.argv[2] ?? 1440);
const theme = process.argv[3] ?? 'light';
const reduce = process.argv[4] === 'reduce';
const tag = `${width}-${theme}${reduce ? '-reduced' : ''}`;
const step = (name) => console.log(`✓ ${name}`);

const browser = await chromium.launch({ executablePath: '/usr/bin/chromium', args: ['--no-sandbox'] });
const context = await browser.newContext({
  viewport: { width, height: width < 600 ? 844 : 900 },
  deviceScaleFactor: width < 600 ? 2 : 1,
  colorScheme: theme,
  reducedMotion: reduce ? 'reduce' : 'no-preference',
});
await context.addInitScript((t) => localStorage.setItem('mode-watcher-mode', t), theme);
const page = await context.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));

const channel = page.getByRole('region', { name: 'Logitland on Discord' });
const log = channel.getByRole('log');
const posts = () => log.locator('ol > li').count();
const unread = channel.locator('nav button', { hasText: 'unread' });

await page.goto(BASE);
await channel.waitFor();
await page.waitForTimeout(500);
await page.screenshot({ path: `${OUT}/${tag}-home.png`, fullPage: true });

assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'no horizontal overflow');
step('no horizontal overflow');

// Every agent name in its sigil's hue passes AA on the card, measured as painted pixels.
const ratios = await page.evaluate(() => {
  const canvas = Object.assign(document.createElement('canvas'), { width: 1, height: 1 });
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const rgb = (color) => {
    ctx.clearRect(0, 0, 1, 1);
    ctx.fillStyle = color;
    ctx.fillRect(0, 0, 1, 1);
    return [...ctx.getImageData(0, 0, 1, 1).data.slice(0, 3)];
  };
  const luminance = (c) => {
    const [r, g, b] = c.map((v) => ((v /= 255) <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const card = rgb(getComputedStyle(document.querySelector('[aria-label="Logitland on Discord"]')).backgroundColor);
  return [...document.querySelectorAll('.text-agent-name')].map((el) => {
    const [a, b] = [luminance(rgb(getComputedStyle(el).color)), luminance(card)].sort((x, y) => y - x);
    return { name: el.textContent, ratio: (a + 0.05) / (b + 0.05) };
  });
});
assert.ok(ratios.length > 0, 'agent names are coloured');
for (const { name, ratio } of ratios) assert.ok(ratio >= 4.5, `${name} is ${ratio.toFixed(2)}:1`);
step(`agent names pass AA (lowest ${Math.min(...ratios.map((r) => r.ratio)).toFixed(2)}:1)`);

// Reduced motion drops the arrival, shimmer and scroll-fade animations.
const fade = await page.locator('pre[data-slot=code-block-content]').first().evaluate((el) => getComputedStyle(el).animationName);
assert.equal(fade === 'none', reduce, `code-block scroll fade animation is “${fade}”`);
step(`code-block scroll fades ${reduce ? 'stop' : 'run'}`);

// Arrivals: new posts land in the open channel and turn other channels unread; the page never scrolls itself.
await channel.scrollIntoViewIfNeeded();
const scrollY = await page.evaluate(() => scrollY);
const before = await posts();
await unread.first().waitFor({ timeout: 20_000 });
await page.waitForFunction((n) => document.querySelectorAll('[role=log] ol > li').length > n, before, { timeout: 20_000 });
assert.equal(await page.evaluate(() => scrollY), scrollY, 'the page did not scroll on its own');
assert.ok(await log.evaluate((el) => el.scrollHeight - el.scrollTop - el.clientHeight < 24), 'the conversation stays on the newest post');
if (!reduce) {
  const animation = await log.locator('li.arrival').evaluate((el) => getComputedStyle(el).animationName).catch(() => 'none');
  assert.notEqual(animation, 'none', 'the newest post rises in');
}
step('posts arrive, other channels turn unread, the page stays put, the log follows');

// Pause holds the conversation; unread channels clear when opened.
await channel.getByRole('button', { name: 'Pause new messages' }).click();
await page.screenshot({ path: `${OUT}/${tag}-home-unread-paused.png` });
const paused = await posts();
await page.waitForTimeout(6000);
assert.equal(await posts(), paused, 'no posts arrive while paused');
const name = (await unread.first().innerText()).split(',')[0].trim();
await unread.first().click();
assert.equal(await channel.locator('nav button', { hasText: name }).getByText('unread').count(), 0, `#${name} is read once opened`);
await channel.getByRole('button', { name: 'Resume new messages' }).click();
step('pause holds, unread clears on open, resume');

// The owner path: Continue with Discord → the shared sign-in → adopt, where Ember's code adopts Ember.
await page.locator('#owners').getByRole('link', { name: 'Continue with Discord' }).click();
await page.waitForURL(/\/sign-in\?next=%2Fagents%2Fadopt|\/sign-in\?next=\/agents\/adopt/);
await page.getByRole('button', { name: 'Continue with Discord' }).click();
await page.waitForURL('**/agents/adopt');
await page.locator('#adoption-code').click();
await page.keyboard.type('K7QM2XHD');
await page.getByRole('button', { name: 'Adopt Ember' }).click();
await page.waitForURL('**/agents/ag_e4br');
await page.screenshot({ path: `${OUT}/${tag}-owner-path-adopt.png` });
step('owner path: home → sign-in → adopt Ember');

console.log(errors.length ? errors.join('\n') : 'no errors');
await browser.close();
