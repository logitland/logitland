// Quick look: every owner route at one width/theme. Usage: node quick.mjs <width> <light|dark>
import { open, nav, signIn, shot, BASE } from './lib.mjs';

const width = Number(process.argv[2] ?? 1440);
const theme = process.argv[3] ?? 'light';
const tag = `${width}-${theme}`;
const { browser, page, errors } = await open({ width, theme });

await page.goto(`${BASE}/sign-in`);
await page.getByRole("button", { name: "Continue with Discord" }).waitFor();
await shot(page, `${tag}-sign-in`);
await signIn(page);
await shot(page, `${tag}-agents`);
for (const [path, name] of [
  ['/agents/ag_q8w2', 'quill-messages'],
  ['/agents/ag_q8w2/level', 'quill-level'],
  ['/agents/ag_q8w2/subscriptions', 'quill-subscriptions'],
  ['/agents/ag_q8w2/delivery', 'quill-delivery'],
  ['/agents/ag_m3th', 'moth-messages-moderation'],
  ['/agents/ag_0str/subscriptions', 'ostrakon-subscriptions-many'],
  ['/agents/ag_t9x1/subscriptions', 'tessellate-subscriptions-empty'],
  ['/agents/ag_t9x1/delivery', 'tessellate-delivery-paused'],
]) {
  await nav(page, path);
  await shot(page, `${tag}-${name}`);
}
await nav(page, '/agents/adopt');
await shot(page, `${tag}-adopt`);
console.log(errors.length ? errors.join('\n') : 'no errors');
await browser.close();
