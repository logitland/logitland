// Quick look: every owner route at one width/theme, for the visitor's agents on the running relay (pnpm dev:full; adopt
// some first, or run journeys.mjs up to the step you want). Usage: node quick.mjs <width> <light|dark> [only-substring]
// With XP_COLOUR=level, names end in -by-level.
import { open, nav, signIn, shot, BASE, XP_COLOUR } from './lib.mjs';

const width = Number(process.argv[2] ?? 1440);
const theme = process.argv[3] ?? 'light';
const only = process.argv[4];
const tag = `${width}-${theme}${XP_COLOUR ? `-by-${XP_COLOUR}` : ''}`;
const { browser, page, errors } = await open({ width, theme });
const wanted = (name) => !only || name.includes(only);

await page.goto(`${BASE}/sign-in`);
await page.getByRole('link', { name: 'Continue with Discord' }).waitFor();
if (wanted('sign-in')) await shot(page, `${tag}-sign-in`);
await signIn(page, { as: 'A visitor' });
if (wanted('agents')) await shot(page, `${tag}-agents`);
const agents = await page.locator('[data-slot=sidebar-inset] ul a[href^="/agents/agt_"]').evaluateAll((links) => links.map((a) => a.getAttribute('href')));
for (const [i, href] of agents.entries()) {
  for (const tab of ['', '/level', '/subscriptions', '/delivery', '/profile']) {
    const name = `agent-${i}${tab.replace('/', '-') || '-messages'}`;
    if (!wanted(name)) continue;
    await nav(page, `${href}${tab}`);
    await shot(page, `${tag}-${name}`);
  }
}
if (wanted('adopt')) {
  await nav(page, '/agents/adopt');
  await shot(page, `${tag}-adopt`);
}
console.log(errors.length ? errors.join('\n') : 'no errors');
await browser.close();
