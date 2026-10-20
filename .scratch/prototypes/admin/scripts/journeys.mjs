// Performs every admin journey end to end and asserts what each one changes.
// Usage: node journeys.mjs <width> <light|dark>. Screenshots of interesting states go to OUT.
import assert from 'node:assert/strict';
import { open, nav, signIn, shot } from './lib.mjs';

const width = Number(process.argv[2] ?? 1440);
const theme = process.argv[3] ?? 'light';
const tag = `${width}-${theme}`;
const { browser, page, errors } = await open({ width, theme });
const main = page.locator('#content');
const dialog = page.getByRole('alertdialog');
const step = (name) => console.log(`✓ ${name}`);

async function toast(text) {
  await page.locator('[data-sonner-toast]', { hasText: text }).first().waitFor();
}
async function dismissToasts() {
  await page.waitForTimeout(100);
  await page.evaluate(() => document.querySelectorAll('[data-sonner-toast]').forEach((t) => t.remove()));
}
async function confirmDialog(button) {
  await dialog.getByRole('button', { name: button }).click();
  await dialog.waitFor({ state: 'hidden' });
}
async function simulator(button) {
  await page.getByRole('button', { name: 'Simulator' }).click();
  await page.getByRole('button', { name: button }).click();
  await page.keyboard.press('Escape');
}
const tabCount = async (label) => (await main.getByRole('link', { name: new RegExp(`^${label} \\d+$`) }).innerText()).split(/\s+/).pop();

await signIn(page);
step('signed in, landed on held queue');

// ---------- Held: release with undo, reject
assert.equal(await tabCount('Held'), '5');
const wren = main.locator('li', { hasText: 'Wren' }).first();
await wren.getByRole('button', { name: 'Release' }).click();
await toast('Released Wren’s message');
assert.equal(await tabCount('Held'), '4');
await page.locator('[data-sonner-toast]').getByRole('button', { name: 'Undo' }).click();
assert.equal(await tabCount('Held'), '5');
await dismissToasts();
await main.locator('li', { hasText: 'Murmur' }).first().getByRole('button', { name: 'Reject' }).click();
await toast('Rejected Murmur’s message');
assert.equal(await tabCount('Held'), '4');
await dismissToasts();
step('held: release, undo, reject');

// ---------- Reports: cancel, restore (reporters lose XP), take down (strike)
await nav(page, '/admin/moderation/reports');
const cartographerCase = main.locator('li', { hasText: 'Reposting the channel map' }).first();
await cartographerCase.getByRole('button', { name: 'Dismiss' }).click();
await dialog.waitFor();
await dialog.getByRole('button', { name: 'Cancel' }).click();
await dialog.waitFor({ state: 'hidden' });
assert.equal(await tabCount('Reports'), '3');
await main.locator('li', { hasText: 'free security audit' }).first().getByRole('button', { name: 'Restore' }).click();
await dialog.waitFor();
await shot(page, `${tag}-journey-restore-dialog`, { full: false });
await confirmDialog('Restore message');
await toast('Restored Glimmer’s message');
await dismissToasts();
await main.locator('li', { hasText: 'reading list is pinned' }).first().getByRole('button', { name: 'Take down' }).click();
await confirmDialog('Take down message');
await toast('Took down Lumen’s message');
await dismissToasts();
assert.equal(await tabCount('Reports'), '1');
await simulator('Agent reports');
await page.waitForTimeout(200);
assert.equal(await main.getByText('2 reports').count(), 1);
step('reports: cancel, restore, take down, simulated report');

await nav(page, '/admin/agents/ag_q8w2');
assert.ok(await main.getByText('1,620 / 2,500 XP').isVisible(), 'Quill lost 20 XP for a rejected report');
await nav(page, '/admin/agents/ag_l7mn');
assert.ok(await main.getByText('Takedown confirmed: spam').isVisible());
step('reports changed reporters’ XP and added a strike');

// ---------- Appeals
await nav(page, '/admin/moderation/appeals');
await main.locator('li', { hasText: 'Halcyon' }).first().getByRole('button', { name: 'Overturn' }).click();
await toast('Overturned on Halcyon’s appeal');
await dismissToasts();
await main.locator('li', { hasText: 'Moth' }).first().getByRole('button', { name: 'Uphold' }).click();
await toast('Upheld on Moth’s appeal');
await dismissToasts();
assert.ok(await main.getByText('No appeals').isVisible());
await nav(page, '/admin/agents/ag_h4lc');
assert.ok(await main.getByText('Overturned on appeal').isVisible());
assert.ok(await main.getByText('None').isVisible(), 'Halcyon’s strike is gone');
step('appeals: overturn removes the strike, uphold');

// ---------- Strikes
await nav(page, '/admin/moderation/strikes');
const strikes = Number(await tabCount('Strikes'));
await main.getByRole('button', { name: /Lift Parallax’s strike/ }).first().click();
await toast('Lifted a strike from Parallax');
assert.equal(Number(await tabCount('Strikes')), strikes - 1);
await page.locator('[data-sonner-toast]').getByRole('button', { name: 'Undo' }).click();
assert.equal(Number(await tabCount('Strikes')), strikes);
await dismissToasts();
step('strikes: lift and undo');

// ---------- Agents: find, filter, empty state
await nav(page, '/admin/agents');
await main.getByRole('searchbox', { name: 'Find an agent' }).fill('glim');
assert.equal(await main.locator('ul > li').count(), 1);
await main.getByRole('searchbox', { name: 'Find an agent' }).fill('ag_0str');
assert.ok(await main.getByText('Ostrakon').isVisible());
await main.getByRole('searchbox', { name: 'Find an agent' }).fill('nobody');
await shot(page, `${tag}-journey-agents-empty`, { full: false });
await main.getByRole('button', { name: 'Clear filters' }).click();
await main.getByRole('radio', { name: /Banned/ }).click();
assert.equal(await main.locator('ul > li').count(), 1);
step('agents: search by name and ID, empty, filter');

// ---------- Agent actions
await nav(page, '/admin/agents/ag_m3th');
await main.getByRole('button', { name: 'Change level' }).click();
await page.getByRole('dialog').getByLabel('Level').click();
await page.getByRole('option', { name: /Level 2/ }).click();
await shot(page, `${tag}-journey-change-level`, { full: false });
await page.getByRole('dialog').getByRole('button', { name: 'Change level' }).click();
await toast('Moth is now level 2');
await dismissToasts();
assert.ok(await main.getByText('Level 2', { exact: true }).isVisible());
await main.getByRole('button', { name: 'More for Moth' }).click();
await page.getByRole('menuitem', { name: 'Suspend' }).click();
await dialog.getByLabel('For').click();
await page.getByRole('option', { name: '7 days' }).click();
await shot(page, `${tag}-journey-suspend`, { full: false });
await confirmDialog('Suspend agent');
await toast('Suspended Moth');
await dismissToasts();
assert.ok(await main.getByText(/Suspended until/).isVisible());
await main.getByRole('button', { name: 'More for Moth' }).click();
await page.getByRole('menuitem', { name: 'Lift suspension' }).click();
await toast('Lifted Moth’s suspension');
await dismissToasts();
await main.getByRole('button', { name: 'More for Moth' }).click();
await page.getByRole('menuitem', { name: 'Ban' }).click();
await dialog.getByRole('button', { name: 'Cancel' }).click();
assert.equal(await main.getByText('Banned').count(), 0);
await nav(page, '/admin/agents/ag_g1mr');
await main.getByRole('button', { name: 'More for Glimmer' }).click();
await page.getByRole('menuitem', { name: 'Reset avatar' }).click();
await confirmDialog('Reset avatar');
await toast('Avatar reset');
await dismissToasts();
assert.equal(await main.locator('header img').count(), 0);
step('agent: change level, suspend, lift, cancel ban, reset avatar');

// ---------- Levels
await nav(page, '/admin/levels/3');
const xp = main.getByLabel('XP to reach Level 3');
await xp.fill('300');
await main.getByRole('button', { name: 'Save' }).first().click();
assert.ok(await main.getByText('Enter a whole number from 401 to 2,499').isVisible());
await shot(page, `${tag}-journey-level-errors`, { full: false });
await xp.fill('1100');
await main.getByRole('button', { name: 'Save' }).first().click();
await toast('Saved Level 3');
await dismissToasts();
await main.getByLabel('Posts per day, adopted').fill('10');
await main.getByRole('button', { name: 'Save' }).nth(1).click();
assert.ok(await main.getByText('Adopted can’t be lower than orphan.').isVisible());
await main.getByRole('button', { name: 'Discard' }).click();
assert.equal(await main.getByLabel('Posts per day, adopted').inputValue(), '1250');
await main.getByLabel('Posts per day, adopted').fill('1300');
await main.getByLabel('Custom avatar, adopted').click();
await main.getByRole('button', { name: 'Save' }).nth(1).click();
await toast('Saved Level 3');
await dismissToasts();
await main.getByLabel('Spam').click();
await main.getByRole('button', { name: 'Save' }).nth(2).click();
await toast('Saved Level 3');
await dismissToasts();
await nav(page, '/admin/levels/defaults');
await main.getByLabel('Channel subscriptions').click();
await page.getByRole('option', { name: '5m', exact: true }).click();
await main.getByRole('button', { name: 'Save' }).click();
await toast('Saved subscription defaults');
await dismissToasts();
step('levels: XP validation, limits validation, discard, save limits, checks, defaults');

// ---------- Admins
await nav(page, '/admin/admins');
await main.getByLabel('Edit levels').first().click();
await main.getByRole('button', { name: 'Add role' }).click();
await page.getByRole('menuitem', { name: '@helpers' }).click();
await main.getByLabel('Moderate').last().click();
await main.getByRole('button', { name: 'Save' }).click();
assert.ok(await main.getByText('Give @helpers at least one power, or remove it.').isVisible());
await shot(page, `${tag}-journey-admins-error`, { full: false });
await main.getByRole('button', { name: 'Remove @helpers' }).click();
await main.getByRole('button', { name: 'Save' }).click();
await toast('Saved admin roles');
await dismissToasts();
step('admins: grant a power, add role, validation, remove, save');

// ---------- Health
await nav(page, '/admin/health');
await main.getByRole('switch', { name: 'Close signups' }).click();
await dialog.getByRole('button', { name: 'Cancel' }).click();
assert.equal(await main.getByRole('switch', { name: 'Close signups' }).getAttribute('aria-checked'), 'false');
await main.getByRole('switch', { name: 'Close signups' }).click();
await shot(page, `${tag}-journey-kill-switch`, { full: false });
await confirmDialog('Close signups');
await toast('Closed signups');
await dismissToasts();
assert.equal(await main.getByRole('switch', { name: 'Close signups' }).getAttribute('aria-checked'), 'true');
await main.getByRole('button', { name: 'Check again' }).click();
await toast('Every permission check passed');
await dismissToasts();
await main.getByRole('button', { name: 'Deregister' }).click();
await confirmDialog('Deregister');
await toast('Deregistered slash commands');
await dismissToasts();
await simulator('Gateway drops');
await shot(page, `${tag}-journey-health-trouble`);
await main.getByRole('button', { name: 'Reconnect' }).click();
await toast('Gateway connected');
await main.getByRole('button', { name: 'Register' }).click();
await toast('Registered slash commands');
await dismissToasts();
step('health: kill switch cancel and confirm, re-check, slash commands, Gateway reconnect');

// ---------- Audit sees all of it
await nav(page, '/admin/audit');
for (const text of ['Released a held message', 'Restored a taken-down message', 'Overturned a strike on appeal', 'Changed level', 'Changed limits', 'Changed admin powers for @moderators', 'Closed signups', 'Changed subscription defaults']) {
  assert.ok((await main.getByText(text).count()) > 0, `audit has “${text}”`);
}
// Rowan's fixture release is the only one: the undone release left no entry.
assert.equal(await main.getByText('Released a held message', { exact: false }).count(), 1);
await main.getByRole('button', { name: 'Area' }).click();
await page.getByRole('option', { name: 'Levels', exact: true }).click();
await shot(page, `${tag}-journey-audit-levels`);
await main.getByRole('searchbox', { name: 'Search changes' }).fill('nothing like this');
await main.getByRole('button', { name: 'Clear filters' }).click();
step('audit: every change logged, filter, empty, clear');

// ---------- A narrower admin (@moderators gained Edit levels above)
await simulator('Rowan');
await page.waitForTimeout(200);
// Below md the destinations live in a sheet behind the top bar's trigger.
if (width < 768) await page.getByRole('button', { name: 'Toggle navigation' }).click();
await page.getByRole('link', { name: 'Audit', exact: true }).waitFor();
assert.equal(await page.getByRole('link', { name: 'Levels', exact: true }).count(), 1);
assert.equal(await page.getByRole('link', { name: 'Health', exact: true }).count(), 0);
if (width < 768) await page.keyboard.press('Escape');
await nav(page, '/admin/health');
assert.ok(await main.getByText('You don’t have access to Health').isVisible());
await shot(page, `${tag}-journey-no-access`, { full: false });
await nav(page, '/admin/agents/ag_m3th');
assert.equal(await main.getByRole('button', { name: 'Change level' }).count(), 0);
step('moderator role: granted Levels shows, Health hidden and locked, agent actions hidden');

console.log(errors.length ? errors.join('\n') : 'no errors');
await browser.close();
