// Shared Playwright helpers for driving the owner dashboard, run against pnpm dev:full.
// Needs playwright-core installed under PW_DIR (default /tmp/owner-proto/pw) and Chromium at /usr/bin/chromium.
import { createRequire } from 'node:module';
const require = createRequire(`${process.env.PW_DIR ?? '/tmp/owner-proto/pw'}/`);
const { chromium } = require('playwright-core');

export const BASE = process.env.BASE ?? 'http://localhost:5193';
export const OUT = process.env.OUT ?? '/tmp/owner-proto/shots';
export const XP_COLOUR = process.env.XP_COLOUR;

export async function open({ width, theme }) {
  const browser = await chromium.launch({ executablePath: '/usr/bin/chromium', args: ['--no-sandbox'] });
  const context = await browser.newContext({
    viewport: { width, height: width < 600 ? 844 : 900 },
    deviceScaleFactor: width < 600 ? 2 : 1,
    colorScheme: theme,
    reducedMotion: 'reduce',
  });
  await context.addInitScript((t) => localStorage.setItem('mode-watcher-mode', t), theme);
  // XP_COLOUR=level colours XP bars by level, as the account menu's preference does.
  if (XP_COLOUR) await context.addInitScript((c) => localStorage.setItem('logitland:xp-colour', c), XP_COLOUR);
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  // The fake Discord's sign-in picker has no favicon; that 404 isn't the dashboard's.
  page.on('console', (m) => m.type() === 'error' && !m.location().url.endsWith('/favicon.ico') && errors.push(m.text()));
  return { browser, page, errors };
}

/** Client-side navigation, so the in-memory store survives. */
export async function nav(page, path) {
  await page.evaluate((p) => {
    const a = document.createElement('a');
    a.href = p;
    document.body.appendChild(a);
    a.click();
    a.remove();
  }, path);
  await page.waitForURL((url) => url.pathname === path.split('?')[0]);
  await page.waitForTimeout(250);
}

/** Signs in through the fake Discord's picker (pnpm dev:full); `as` is the person's name there. */
export async function signIn(page, { as = 'Luna (admin)' } = {}) {
  await page.goto(`${BASE}/sign-in`);
  await page.getByRole('link', { name: 'Continue with Discord' }).click();
  await page.getByRole('link', { name: as }).click();
  await page.waitForURL('**/agents');
  await page.waitForTimeout(300);
}

export async function shot(page, name, { full = true } = {}) {
  await page.waitForTimeout(200);
  await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: full });
}
