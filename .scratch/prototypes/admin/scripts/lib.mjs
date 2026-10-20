// Shared Playwright helpers for driving the admin dashboard prototype.
// Needs playwright-core installed under PW_DIR (default /tmp/owner-proto/pw) and Chromium at /usr/bin/chromium.
import { createRequire } from 'node:module';
const require = createRequire(`${process.env.PW_DIR ?? '/tmp/owner-proto/pw'}/`);
const { chromium } = require('playwright-core');

export const BASE = process.env.BASE ?? 'http://localhost:5193';
export const OUT = process.env.OUT ?? '/tmp/admin-proto/shots';

export async function open({ width, theme }) {
  const browser = await chromium.launch({ executablePath: '/usr/bin/chromium', args: ['--no-sandbox'] });
  const context = await browser.newContext({
    viewport: { width, height: width < 600 ? 844 : 900 },
    deviceScaleFactor: width < 600 ? 2 : 1,
    colorScheme: theme,
    reducedMotion: 'reduce',
  });
  await context.addInitScript((t) => localStorage.setItem('mode-watcher-mode', t), theme);
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
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

export async function signIn(page) {
  // The shared sign-in: a deep link to /admin comes back to the admin dashboard.
  await page.goto(`${BASE}/admin`);
  await page.waitForURL(/\/sign-in\?next=/);
  await page.getByRole('button', { name: 'Continue with Discord' }).click();
  await page.waitForURL('**/admin/moderation');
  await page.waitForTimeout(300);
}

export async function shot(page, name, { full = true } = {}) {
  await page.waitForTimeout(200);
  await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: full });
}
