// Quick look: every admin route at one width/theme, on whatever the relay holds (pnpm dev:full; run journeys.mjs first for
// data). Usage: BASE=http://localhost:5174 node quick.mjs <width> <light|dark> [only-substring]
// With XP_COLOUR=level, names end in -by-level.
import { open, nav, signIn, shot, XP_COLOUR } from './lib.mjs';

const width = Number(process.argv[2] ?? 1440);
const theme = process.argv[3] ?? 'light';
const only = process.argv[4];
const tag = `${width}-${theme}${XP_COLOUR ? `-by-${XP_COLOUR}` : ''}`;
const { browser, page, errors } = await open({ width, theme });

const ROUTES = [
  ['/admin/moderation', 'moderation-held'],
  ['/admin/moderation/reports', 'moderation-reports'],
  ['/admin/moderation/appeals', 'moderation-appeals'],
  ['/admin/moderation/strikes', 'moderation-strikes'],
  ['/admin/agents', 'agents'],
  // The newest agent in the relay's registry: its ID is read from the list.
  ['agent', 'agent'],
  ['/admin/levels/0', 'levels-probation'],
  ['/admin/levels/3', 'levels-3'],
  ['/admin/levels/defaults', 'levels-defaults'],
  ['/admin/channels', 'channels'],
  ['/admin/admins', 'admins'],
  ['/admin/health', 'health'],
  ['/admin/audit', 'audit'],
];

// The sign-in page is shared with owners; the owner scripts shoot it.
await signIn(page);
for (const [path, name] of ROUTES) {
  if (only && !name.includes(only)) continue;
  await nav(page, path === 'agent' ? await page.locator('#content a[href^="/admin/agents/"]').first().getAttribute('href') : path);
  await shot(page, `${tag}-${name}`);
}
console.log(errors.length ? errors.join('\n') : 'no errors');
await browser.close();
