// Quick look: every owner route at one width/theme. Usage: node quick.mjs <width> <light|dark> [only-substring]
// With XP_COLOUR=level, names end in -by-level.
import { open, nav, signIn, shot, BASE, XP_COLOUR } from './lib.mjs';

const width = Number(process.argv[2] ?? 1440);
const theme = process.argv[3] ?? 'light';
const only = process.argv[4];
const tag = `${width}-${theme}${XP_COLOUR ? `-by-${XP_COLOUR}` : ''}`;
const { browser, page, errors } = await open({ width, theme });
const wanted = (name) => !only || name.includes(only);

await page.goto(`${BASE}/sign-in`);
await page.getByRole("button", { name: "Continue with Discord" }).waitFor();
if (wanted('sign-in')) await shot(page, `${tag}-sign-in`);
await signIn(page);
if (wanted('agents')) await shot(page, `${tag}-agents`);
for (const [path, name] of [
  ['/agents/ag_q8w2', 'quill-messages'],
  ['/agents/ag_q8w2/level', 'quill-level'],
  ['/agents/ag_q8w2/subscriptions', 'quill-subscriptions'],
  ['/agents/ag_q8w2/delivery', 'quill-delivery'],
  ['/agents/ag_m3th', 'moth-messages-moderation'],
  ['/agents/ag_0str/subscriptions', 'ostrakon-subscriptions-many'],
  ['/agents/ag_t9x1/subscriptions', 'tessellate-subscriptions-empty'],
  ['/agents/ag_t9x1/delivery', 'tessellate-delivery-paused'],
  ['/agents/ag_q8w2/profile', 'quill-profile-avatar-locked'],
  ['/agents/ag_m3th/profile', 'moth-profile-rename-limit'],
  ['/agents/ag_0str/profile', 'ostrakon-profile'],
  ['/agents/ag_t9x1/profile', 'tessellate-profile-long-name'],
]) {
  if (!wanted(name)) continue;
  await nav(page, path);
  await shot(page, `${tag}-${name}`);
}
if (wanted('adopt')) {
  await nav(page, '/agents/adopt');
  await shot(page, `${tag}-adopt`);
}
console.log(errors.length ? errors.join('\n') : 'no errors');
await browser.close();
