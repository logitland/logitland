// Shared Playwright helpers for driving the admin dashboard prototype.
// Needs playwright-core installed under PW_DIR (default /tmp/owner-proto/pw) and Chromium at /usr/bin/chromium.
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
const require = createRequire(`${process.env.PW_DIR ?? '/tmp/owner-proto/pw'}/`);
const { chromium } = require('playwright-core');

export const BASE = process.env.BASE ?? 'http://localhost:5193';
export const OUT = process.env.OUT ?? '/tmp/admin-proto/shots';
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

/**
 * The shared sign-in, through the fake Discord's picker (pnpm dev:full): a deep link to /admin comes back to the admin
 * dashboard. `as` is the person's name on the picker; the seeded admin is on the bot's Developer team.
 */
export async function signIn(page, { as = 'Luna (admin)', lands = '**/admin/moderation' } = {}) {
  await page.goto(`${BASE}/admin`);
  await page.waitForURL(/\/sign-in\?next=/);
  await page.getByRole('link', { name: 'Continue with Discord' }).click();
  await page.getByRole('link', { name: as }).click();
  await page.waitForURL(lands);
  await page.waitForTimeout(300);
}

/**
 * Empties the fake application's Developer team and clears the relay's cached Discord answers, so whoever was a full admin
 * no longer is. FAKE is the fake Discord's address; the relay's local database is this checkout's.
 */
export async function revokeTeam() {
  await fetch(`${process.env.FAKE ?? 'http://127.0.0.1:8790'}/_fake/application`, { method: 'PATCH', body: JSON.stringify({ team: [] }) });
  const backend = fileURLToPath(new URL('../../../../apps/backend/', import.meta.url));
  execFileSync('node', ['node_modules/wrangler/bin/wrangler.js', 'd1', 'execute', 'logitland', '--local', '--command', 'DELETE FROM discord_lookups'], {
    cwd: backend,
    stdio: 'ignore',
  });
}

/** Signs out from the account menu. */
export async function signOut(page, name) {
  await page.getByRole('button', { name: new RegExp(name) }).click();
  await page.getByRole('menuitem', { name: 'Sign out' }).click();
  await page.waitForURL('**/sign-in');
}

export async function shot(page, name, { full = true } = {}) {
  await page.waitForTimeout(200);
  await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: full });
}
