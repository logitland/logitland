// Performs every owner journey end to end, asserting results. Usage: node journeys.mjs <width> <light|dark>
import assert from 'node:assert/strict';
import { open, nav, shot, BASE } from './lib.mjs';

const width = Number(process.argv[2] ?? 1440);
const theme = process.argv[3] ?? 'light';
const tag = `j-${width}-${theme}`;
const mobile = width < 768;
const { browser, page, errors } = await open({ width, theme });
const step = (name) => console.log(`✓ ${name}`);
const main = () => page.locator('[data-slot=sidebar-inset]');
const text = async (s) => (await page.locator('body').innerText()).includes(s);

async function pick(trigger, option) {
  await trigger.click();
  await page.getByRole('option', { name: option, exact: true }).click();
  await page.waitForTimeout(150);
}

async function simulator(button) {
  await page.getByRole('button', { name: 'Simulator' }).click();
  await page.getByRole('button', { name: button }).click();
  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);
}

async function sidebarLink(name) {
  if (mobile) await page.getByRole('button', { name: 'Toggle navigation' }).click();
  await page.getByRole('link', { name, exact: true }).first().click();
  await page.waitForTimeout(300);
}

// 1. Deep link while signed out → sign in → back to the deep link
await page.goto(`${BASE}/agents/ag_q8w2/delivery`);
await page.waitForURL(/\/sign-in\?next=/);
await page.getByRole('button', { name: 'Continue with Discord' }).click();
await page.getByRole('button', { name: /Signing in/ }).waitFor();
await shot(page, `${tag}-sign-in-loading`, { full: false });
await page.waitForURL('**/agents/ag_q8w2/delivery');
step('sign-in returns to the requested page');

// Mobile navigation sheet
if (mobile) {
  await page.getByRole('button', { name: 'Toggle navigation' }).click();
  await page.waitForTimeout(300);
  await shot(page, `${tag}-nav-sheet`, { full: false });
  await page.keyboard.press('Escape');
  step('navigation sheet opens');
}

// 2. Adopt by code: unknown, expired, then valid
await sidebarLink('Adopt agent');
await page.waitForURL('**/agents/adopt');
const codeInput = page.locator('#adoption-code');
await codeInput.click();
await page.keyboard.type('zzzz0000');
await page.getByText('No orphan has this code').waitFor();
await shot(page, `${tag}-adopt-code-unknown`, { full: false });
await page.keyboard.press('Control+A');
for (let i = 0; i < 8; i++) await page.keyboard.press('Backspace');
await page.keyboard.type('P3LV8JQA');
await page.getByText('This code expired').waitFor();
for (let i = 0; i < 8; i++) await page.keyboard.press('Backspace');
await page.keyboard.type('k7qm2xhd');
await page.getByRole('button', { name: 'Adopt Ember' }).waitFor();
await shot(page, `${tag}-adopt-code-found`, { full: false });
await page.getByRole('button', { name: 'Clear' }).click();
assert.equal(await page.getByRole('button', { name: 'Adopt Ember' }).count(), 0);
await codeInput.click();
await page.keyboard.type('K7QM2XHD');
await page.getByRole('button', { name: 'Adopt Ember' }).click();
await page.waitForURL('**/agents/ag_e4br');
await page.getByText('Adopted Ember').first().waitFor();
await shot(page, `${tag}-adopt-code-done`, { full: false });
step('adopt by code: unknown, expired, clear, adopt');

// 3. Adopt by token: create, cancel, expire, confirm
await sidebarLink('Adopt agent');
await page.getByRole('tab', { name: 'Create token' }).click();
await shot(page, `${tag}-adopt-token-empty`, { full: false });
await page.getByRole('button', { name: 'Create token', exact: true }).click();
await page.getByText('Waiting for your agent to confirm').waitFor();
await shot(page, `${tag}-adopt-token-waiting`, { full: false });
await page.getByRole('button', { name: 'Cancel token' }).click();
await page.getByRole('button', { name: 'Create token', exact: true }).click();
await nav(page, '/agents');
assert.ok(await text('Waiting for an agent to confirm'), 'pending token shows on the agents list');
await shot(page, `${tag}-agents-token-pending`, { full: false });
await nav(page, '/agents/adopt');
await simulator('Expire');
await page.getByText('Expired before an agent confirmed it.').waitFor();
await shot(page, `${tag}-adopt-token-expired`, { full: false });
await page.getByRole('button', { name: 'Create new token' }).click();
await simulator('Lumen confirms');
await page.getByRole('button', { name: 'Open Lumen' }).waitFor();
await shot(page, `${tag}-adopt-token-confirmed`, { full: false });
await page.getByRole('button', { name: 'Open Lumen' }).click();
await page.waitForURL('**/agents/ag_l7mn');
step('adopt by token: cancel, expire, confirm, open');

// 4. Subscriptions on Moth: validation, add, frequency, remove + undo, limit
await nav(page, '/agents/ag_m3th/subscriptions');
await main().getByRole('button', { name: 'Add subscription' }).click();
assert.ok(await page.locator('#kind-replies').isDisabled(), 'replies disabled when subscribed');
await page.getByRole('dialog').getByRole('button', { name: 'Add subscription' }).click();
await page.getByText('Choose a channel.').waitFor();
await shot(page, `${tag}-subscription-dialog-error`, { full: false });
await pick(page.locator('#subscription-channel'), '#research');
assert.equal((await page.locator('#subscription-frequency').innerText()).trim(), '30s');
await page.getByRole('dialog').getByRole('button', { name: 'Add subscription' }).click();
await page.getByText('Subscribed to #research').waitFor();
await pick(page.getByRole('button', { name: 'Frequency for #general' }), '5m');
assert.equal((await page.getByRole('button', { name: 'Frequency for #general' }).innerText()).trim(), '5m');
await page.getByRole('button', { name: 'Unsubscribe from #general' }).click();
assert.equal(await page.getByRole('button', { name: 'Unsubscribe from #general' }).count(), 0);
await page.getByRole('button', { name: 'Undo' }).click();
await page.getByRole('button', { name: 'Unsubscribe from #general' }).waitFor();
// Cancel keeps the list unchanged
await main().getByRole('button', { name: 'Add subscription' }).click();
await page.getByRole('dialog').getByRole('button', { name: 'Cancel' }).click();
await page.getByRole('dialog').waitFor({ state: 'detached' });
for (const channel of ['#introductions', '#off-topic', '#code-review']) {
  await main().getByRole('button', { name: 'Add subscription' }).click();
  await pick(page.locator('#subscription-channel'), channel);
  await page.getByRole('dialog').getByRole('button', { name: 'Add subscription' }).click();
  await page.getByRole('dialog').waitFor({ state: 'detached' });
}
await page.getByText('Limit reached').waitFor();
assert.ok(await main().getByRole('button', { name: 'Add subscription' }).isDisabled());
await shot(page, `${tag}-subscriptions-limit`, { full: false });
step('subscriptions: validate, add, frequency, undo, cancel, limit');

// 5. Delivery on Moth: validation, challenge failure, success + secret once, rotate
await nav(page, '/agents/ag_m3th/delivery');
await page.getByText('Webhook', { exact: true }).click();
const url = page.locator('#webhook-url');
for (const [value, error] of [
  ['moth', 'Enter a full URL'],
  ['http://moth.example.com/hook', 'Use an https URL.'],
  ['https://localhost/hook', 'Use a public host.'],
]) {
  await url.fill(value);
  await page.getByRole('button', { name: 'Save' }).first().click();
  await page.getByText(error).waitFor();
}
await shot(page, `${tag}-delivery-url-error`, { full: false });
await url.fill('https://moth.test/hook');
await page.getByRole('button', { name: 'Save' }).first().click();
await page.getByRole('button', { name: /Verifying URL/ }).waitFor();
await page.getByText('didn’t answer the challenge').waitFor();
await shot(page, `${tag}-delivery-challenge-failed`, { full: false });
await url.fill('https://moth.example.com/hook');
await page.getByRole('button', { name: 'Save' }).first().click();
await page.getByRole('dialog').getByText(/whsec_/).waitFor();
await shot(page, `${tag}-delivery-secret`, { full: false });
await page.getByRole('button', { name: 'Done' }).click();
await page.getByRole('dialog').waitFor({ state: 'detached' });
await page.getByText('Active', { exact: true }).waitFor();
await main().getByRole('button', { name: 'Rotate secret' }).click();
await shot(page, `${tag}-delivery-rotate-confirm`, { full: false });
await page.getByRole('alertdialog').getByRole('button', { name: 'Cancel' }).click();
await page.getByRole('alertdialog').waitFor({ state: 'detached' });
await main().getByRole('button', { name: 'Rotate secret' }).click();
await page.getByRole('alertdialog').getByRole('button', { name: 'Rotate secret' }).click();
await page.getByRole('dialog').getByText(/whsec_/).waitFor();
await page.keyboard.press('Escape');
await page.getByRole('dialog').waitFor({ state: 'detached' });
// Discard reverts an unsaved change
await page.getByText('None', { exact: true }).click();
await page.getByRole('button', { name: 'Discard' }).first().click();
assert.ok(await url.isVisible(), 'discard restores the webhook');
step('delivery: validation, challenge failure, secret once, rotate, discard');

// Daily cap on Moth
await page.locator('#cap-enabled').click();
await page.locator('#cap-value').fill('0');
await page.getByRole('button', { name: 'Save' }).last().click();
await page.getByText('Enter a whole number from 1').waitFor();
await shot(page, `${tag}-cap-error`, { full: false });
await page.locator('#cap-value').fill('2000');
await page.getByRole('button', { name: 'Save' }).last().click();
await page.getByText('Capped at 2,000 a day').waitFor();
await nav(page, '/agents');
assert.ok(await text('/ 2,000'), 'cap shows on the agents list');
step('daily cap: validation, save, list reflects it');

// Resume a paused webhook
await nav(page, '/agents/ag_t9x1/delivery');
await page.getByRole('button', { name: 'Resume' }).click();
await page.getByText('Deliveries resumed').waitFor();
assert.ok(await page.getByText('Active', { exact: true }).isVisible());
step('paused delivery resumes');

// 6. Revoke with cancel, then confirm
await page.getByRole('button', { name: /^More for/ }).focus();
await page.keyboard.press('Enter');
await page.getByRole('menuitem', { name: 'Revoke registration' }).focus();
await page.keyboard.press('Enter');
await shot(page, `${tag}-revoke-confirm`, { full: false });
await page.getByRole('alertdialog').getByRole('button', { name: 'Cancel' }).click();
await page.getByRole('alertdialog').waitFor({ state: 'detached' });
assert.ok(await text('Tessellate-9'), 'cancel keeps the agent');
await page.getByRole('button', { name: /^More for/ }).focus();
await page.keyboard.press('Enter');
await page.getByRole('menuitem', { name: 'Revoke registration' }).focus();
await page.keyboard.press('Enter');
await page.getByRole('alertdialog').getByRole('button', { name: 'Revoke registration' }).click();
await page.waitForURL('**/agents');
await page.waitForTimeout(300);
assert.ok(!(await main().innerText()).includes('Tessellate-9'), 'revoked agent leaves the list');
await nav(page, '/agents/ag_t9x1');
await page.getByText('Agent not found', { exact: true }).waitFor();
await shot(page, `${tag}-agent-not-found`, { full: false });
step('revoke: cancel, confirm, gone everywhere');

// 7. New owner: empty states; sign out
await simulator('New owner');
await page.getByText('No agents yet', { exact: true }).waitFor();
await shot(page, `${tag}-agents-empty`, { full: false });
if (mobile) {
  await page.getByRole('button', { name: 'Toggle navigation' }).focus();
  await page.keyboard.press('Enter');
}
await page.getByRole('button', { name: /Ada/ }).click();
await shot(page, `${tag}-account-menu`, { full: false });
await page.getByRole('menuitem', { name: 'Sign out' }).click();
await page.waitForURL(/\/sign-in/);
step('empty state, account menu, sign out');

console.log(errors.length ? `console errors:\n${errors.join('\n')}` : 'no console errors');
await browser.close();
