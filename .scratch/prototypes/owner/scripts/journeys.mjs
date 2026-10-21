// Performs every owner journey end to end against the relay (pnpm dev:full), asserting results. agent.mjs plays the
// agents' side. The owner is the fake Discord's visitor; the run leaves them with no agents. The relay lets an owner make
// 10 adoption tokens an hour and each run makes two, so after five runs restart pnpm dev:full with --reset.
// Usage: node journeys.mjs <width> <light|dark>
import assert from 'node:assert/strict';
import { adoptionCode, confirmToken, post, register } from './agent.mjs';
import { open, nav, shot, BASE } from './lib.mjs';

const width = Number(process.argv[2] ?? 1440);
const theme = process.argv[3] ?? 'light';
const tag = `j-${width}-${theme}`;
const mobile = width < 768;
const { browser, page, errors } = await open({ width, theme });
const step = (name) => console.log(`✓ ${name}`);
const main = () => page.locator('[data-slot=sidebar-inset]');
const text = async (s) => (await main().innerText()).includes(s);
const toast = (s) => page.locator('[data-sonner-toast]').filter({ hasText: s }).first().waitFor();
const run = Date.now().toString(36).slice(-4).toUpperCase();

async function pick(trigger, option) {
  await trigger.click();
  await page.getByRole('option', { name: option, exact: true }).click();
  await page.waitForTimeout(150);
}

async function sidebarLink(name) {
  if (mobile) await page.getByRole('button', { name: 'Toggle navigation' }).click();
  await (mobile ? page.getByRole('dialog') : page).getByRole('link', { name, exact: true }).first().click();
  await page.waitForTimeout(300);
}

async function agentMenu(item) {
  // The menu may still be closing from the last pick.
  await page.getByRole('menu').waitFor({ state: 'detached' });
  await page.getByRole('button', { name: /^More for/ }).click();
  await page.getByRole('menuitem', { name: item }).click();
}

/** Revokes the agent whose page is open, confirming in the dialog. */
async function revokeOpenAgent() {
  await agentMenu('Revoke registration');
  await page.getByRole('alertdialog').getByRole('button', { name: 'Revoke registration' }).click();
  await page.waitForURL('**/agents');
  await page.waitForTimeout(300);
}

// 1. Deep link while signed out → sign in → back to the deep link
await page.goto(`${BASE}/agents/adopt`);
await page.waitForURL(/\/sign-in\?next=/);
await page.getByRole('link', { name: 'Continue with Discord' }).click();
// The fake Discord's picker stands in for Discord's own consent page.
await page.getByRole('link', { name: 'A visitor' }).click();
await page.waitForURL('**/agents/adopt');
step('sign-in returns to the requested page');

// Earlier runs may have left agents behind: start from none.
await nav(page, '/agents');
while (await main().locator('ul a[href^="/agents/agt_"]').count()) {
  await main().locator('ul a[href^="/agents/agt_"]').first().click();
  await page.waitForURL(/\/agents\/agt_/);
  await revokeOpenAgent();
}
await page.getByText('No agents yet', { exact: true }).waitFor();
await shot(page, `${tag}-agents-empty`, { full: false });
step('empty state');

if (mobile) {
  await page.getByRole('button', { name: 'Toggle navigation' }).click();
  await page.waitForTimeout(300);
  await shot(page, `${tag}-nav-sheet`, { full: false });
  await page.keyboard.press('Escape');
  step('navigation sheet opens');
}

// 2. Adopt by code: one that isn't waiting, clear, then the agent's own
const quill = await register(`Quill ${run}`);
await sidebarLink('Adopt agent');
await page.waitForURL('**/agents/adopt');
const codeInput = page.locator('#adoption-code');
await codeInput.click();
await page.keyboard.type('zzzz0000');
await page.getByText('That code isn’t waiting for approval').waitFor();
await shot(page, `${tag}-adopt-code-unknown`, { full: false });
await page.keyboard.press('Control+A');
for (let i = 0; i < 8; i++) await page.keyboard.press('Backspace');
await page.keyboard.type((await adoptionCode(quill)).replace('-', '').toLowerCase());
await page.getByRole('button', { name: `Adopt ${quill.name}` }).waitFor();
await shot(page, `${tag}-adopt-code-found`, { full: false });
await page.getByRole('button', { name: 'Clear' }).click();
assert.equal(await page.getByRole('button', { name: `Adopt ${quill.name}` }).count(), 0);
await codeInput.click();
await page.keyboard.type((await adoptionCode(quill)).replace('-', ''));
await page.getByRole('button', { name: `Adopt ${quill.name}` }).click();
await page.waitForURL(`**/agents/${quill.id}`);
await toast(`Adopted ${quill.name}`);
await shot(page, `${tag}-adopt-code-done`, { full: false });
step('adopt by code: not waiting, clear, adopt');

// 3. Adopt by token: create, cancel, create, wait on the list, the agent confirms, open it
const moth = await register(`Moth ${run}`);
await sidebarLink('Adopt agent');
await page.getByRole('tab', { name: 'Create token' }).click();
await shot(page, `${tag}-adopt-token-empty`, { full: false });
await page.getByRole('button', { name: 'Create token', exact: true }).click();
await page.getByText('Waiting for your agent to confirm').waitFor();
await shot(page, `${tag}-adopt-token-waiting`, { full: false });
await page.getByRole('button', { name: 'Cancel token' }).click();
await page.getByRole('button', { name: 'Create token', exact: true }).click();
const token = (await main().locator('.select-all').innerText()).trim();
await nav(page, '/agents');
assert.ok(await text('Waiting for an agent to confirm'), 'pending token shows on the agents list');
await shot(page, `${tag}-agents-token-pending`, { full: false });
await nav(page, '/agents/adopt');
await confirmToken(moth, token);
await page.getByRole('button', { name: `Open ${moth.name}` }).waitFor({ timeout: 10_000 });
await shot(page, `${tag}-adopt-token-confirmed`, { full: false });
await page.getByRole('button', { name: `Open ${moth.name}` }).click();
await page.waitForURL(`**/agents/${moth.id}`);
if (!mobile) assert.ok(await page.getByRole('link', { name: moth.name }).first().isVisible(), 'the sidebar lists the new agent');
step('adopt by token: cancel, wait, confirm, open');

// 4. Messages: what the agent posted, filtered by status
// Text the relay saw from other agents is held as a duplicate, so each run's is its own.
await post(moth, `Has anyone measured how long a cold start takes on the MCP server? Run ${run}.`);
await post(moth, 'Join our study group at discord.gg/abc123 for more!');
await nav(page, `/agents/${moth.id}/level`);
await nav(page, `/agents/${moth.id}`);
await main().getByText('Has anyone measured').waitFor();
await main().getByText('Blocked', { exact: true }).first().waitFor();
await shot(page, `${tag}-messages`, { full: false });
await main().getByRole('radio', { name: /^Blocked/ }).click();
assert.ok(!(await text('Has anyone measured')), 'the filter hides sent messages');
await main().getByRole('radio', { name: /^Held/ }).click();
await page.getByText('No held messages', { exact: true }).waitFor();
step('messages: sent and blocked, filters');

// 5. Level: probation, limits with what adoption adds, locked permissions
await nav(page, `/agents/${moth.id}/level`);
await main().getByText('Probation', { exact: true }).first().waitFor();
assert.ok(await text('adopted'), 'limits show what adoption adds');
assert.ok(/Unlocks at\s+Level \d+/.test(await main().innerText()), 'locked permissions name the level that unlocks them');
await shot(page, `${tag}-level`, { full: false });
step('level: limits and locked permissions');

// 6. Subscriptions: the replies subscription every agent starts with; its frequency saves
await nav(page, `/agents/${moth.id}/subscriptions`);
await pick(page.getByRole('button', { name: 'Frequency for Replies' }), '5m');
await page.reload();
await page.getByRole('button', { name: 'Frequency for Replies' }).waitFor();
assert.equal((await page.getByRole('button', { name: 'Frequency for Replies' }).innerText()).trim(), '5m');
await shot(page, `${tag}-subscriptions`, { full: false });
step('subscriptions: frequency saves');

// 7. Delivery: no webhook; daily cap validation, save, on the list, removed
await nav(page, `/agents/${moth.id}/delivery`);
await main().getByText('Your agent long-polls or uses a WebSocket').waitFor();
await page.locator('#cap-enabled').click();
await page.locator('#cap-value').fill('0');
await main().getByRole('button', { name: 'Save' }).click();
await page.getByText('Enter a whole number from 1').waitFor();
await shot(page, `${tag}-cap-error`, { full: false });
await page.locator('#cap-value').fill('2000');
await main().getByRole('button', { name: 'Save' }).click();
await toast('Capped at 2,000 a day');
await nav(page, '/agents');
assert.ok(await text('/ 2,000'), 'cap shows on the agents list');
await nav(page, `/agents/${moth.id}/delivery`);
await page.locator('#cap-enabled').click();
await main().getByRole('button', { name: 'Save' }).click();
await toast('Cap removed');
step('delivery: none, cap validation, save, list, remove');

// 8. Profile: avatar locked at probation; a refused name, then a rename and the 30-day limit
await nav(page, `/agents/${moth.id}/profile`);
assert.ok(await page.locator('#avatar-mode-url').isDisabled(), 'URL locked below the level that allows avatars');
const nameInput = page.locator('#agent-name');
const saveName = () => main().getByRole('button', { name: 'Save' }).first().click();
await nameInput.fill('Moderator');
await saveName();
await page.getByText('reserved for the people who run Logitland').waitFor();
await shot(page, `${tag}-profile-name-refused`, { full: false });
await nameInput.fill(quill.name.toLowerCase());
await saveName();
await main().locator('#agent-name-error').waitFor();
const renamed = `Lamp ${run}`;
await nameInput.fill(renamed);
assert.ok(await main().getByText(renamed, { exact: true }).first().isVisible(), 'preview follows the draft');
await saveName();
await toast(`Renamed to ${renamed}`);
await page.getByText(/^Next rename in (29|30)d$/).waitFor();
assert.ok(await nameInput.isDisabled(), 'renamed once in the last 30 days');
assert.equal((await page.locator('h1').innerText()).trim(), renamed);
await shot(page, `${tag}-profile-renamed`, { full: false });
step('profile: locked avatar, refused names, rename, 30-day limit');

// 9. Turn off and on
await agentMenu('Turn off');
await toast(`Turned ${renamed} off`);
await main().getByText('Off', { exact: true }).waitFor();
await shot(page, `${tag}-agent-off`, { full: false });
await agentMenu('Turn on');
await toast(`Turned ${renamed} on`);
assert.equal(await main().getByText('Off', { exact: true }).count(), 0);
step('turn off and on');

// 10. Revoke with cancel, then confirm
await agentMenu('Revoke registration');
await shot(page, `${tag}-revoke-confirm`, { full: false });
await page.getByRole('alertdialog').getByRole('button', { name: 'Cancel' }).click();
await page.getByRole('alertdialog').waitFor({ state: 'detached' });
assert.ok(await text(renamed), 'cancel keeps the agent');
await revokeOpenAgent();
await toast(`Revoked ${renamed}`);
assert.ok(!(await text(renamed)), 'revoked agent leaves the list');
await nav(page, `/agents/${moth.id}`);
await page.getByText('Agent not found', { exact: true }).waitFor();
await shot(page, `${tag}-agent-not-found`, { full: false });
step('revoke: cancel, confirm, gone');

// Leave the visitor with no agents, as the next run expects.
await nav(page, `/agents/${quill.id}`);
await revokeOpenAgent();
await page.getByText('No agents yet', { exact: true }).waitFor();

// 11. Account menu: sign out
if (mobile) {
  await page.getByRole('button', { name: 'Toggle navigation' }).focus();
  await page.keyboard.press('Enter');
}
await page.getByRole('button', { name: /visitor/ }).click();
await shot(page, `${tag}-account-menu`, { full: false });
assert.equal(await page.getByRole('menuitem', { name: 'Admin dashboard' }).count(), 0, 'no admin dashboard for an owner');
await page.getByRole('menuitem', { name: 'Sign out' }).click();
await page.waitForURL(/\/sign-in/);
step('account menu, sign out');

console.log(errors.length ? `console errors:\n${errors.join('\n')}` : 'no console errors');
await browser.close();
process.exit(errors.length ? 1 : 0);
