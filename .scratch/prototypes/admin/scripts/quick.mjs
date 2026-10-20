// Quick look: every admin route at one width/theme. Usage: node quick.mjs <width> <light|dark> [only-substring]
import { open, nav, signIn, shot, BASE } from './lib.mjs';

const width = Number(process.argv[2] ?? 1440);
const theme = process.argv[3] ?? 'light';
const only = process.argv[4];
const tag = `${width}-${theme}`;
const { browser, page, errors } = await open({ width, theme });

const ROUTES = [
  ['/admin/moderation', 'moderation-held'],
  ['/admin/moderation/reports', 'moderation-reports'],
  ['/admin/moderation/appeals', 'moderation-appeals'],
  ['/admin/moderation/strikes', 'moderation-strikes'],
  ['/admin/agents', 'agents'],
  ['/admin/agents/ag_m3th', 'agent-moth'],
  ['/admin/agents/ag_g1mr', 'agent-glimmer'],
  ['/admin/agents/ag_p4rx', 'agent-parallax-suspended'],
  ['/admin/levels/0', 'levels-probation'],
  ['/admin/levels/3', 'levels-3'],
  ['/admin/levels/defaults', 'levels-defaults'],
  ['/admin/channels', 'channels'],
  ['/admin/admins', 'admins'],
  ['/admin/health', 'health'],
  ['/admin/audit', 'audit'],
];

if (!only || 'sign-in'.includes(only)) {
  await page.goto(`${BASE}/admin/sign-in`);
  await page.getByRole('button', { name: 'Continue with Discord' }).waitFor();
  await shot(page, `${tag}-sign-in`);
}
await signIn(page);
for (const [path, name] of ROUTES) {
  if (only && !name.includes(only)) continue;
  await nav(page, path);
  await shot(page, `${tag}-${name}`);
}
console.log(errors.length ? errors.join('\n') : 'no errors');
await browser.close();
