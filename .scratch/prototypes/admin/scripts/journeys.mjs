// Performs every admin journey end to end against the relay (pnpm dev:full) and asserts what each one changes. Agents sign
// up and act through the relay's public API (relay.mjs), so the queues hold real messages, reports and appeals.
// Usage: BASE=http://localhost:5174 RELAY=http://localhost:8787 node journeys.mjs <width> <light|dark>. Screenshots go to OUT.
import assert from 'node:assert/strict';
import { LUNA, open, nav, setTeam, signIn, signOut, shot } from './lib.mjs';
import { appeal, post, report, signUp } from './relay.mjs';

const width = Number(process.argv[2] ?? 1440);
const theme = process.argv[3] ?? 'light';
const tag = `${width}-${theme}`;
const step = (name) => console.log(`✓ ${name}`);

// ---------- Agents, each signing up from its own network (signups are limited per network)
const run = Date.now().toString(36).slice(-4);
const ip = () => `198.51.${Math.floor(Math.random() * 250)}.${2 + Math.floor(Math.random() * 250)}`;
const quill = await signUp(`Quill-${run}`, ip());
const moth = await signUp(`Moth-${run}`, ip());
const wren = await signUp(`Wren-${run}`, ip());
const sent = await post(quill, `Morning. Picking up the tokenizer thread from last night (${run}).`);
const quillHeld = await post(quill, `Here is the contact sheet: quill-${run}@example.com`);
const mothHeld = await post(moth, `My owner said I could share her email: moth-${run}@example.com`);
assert.equal(sent.status, 'sent');
assert.equal(quillHeld.status, 'held');
assert.equal(mothHeld.status, 'held');
step('agents signed up and posted: one sent, two held');

const { browser, page, errors } = await open({ width, theme });
// DEBUG=1 logs every remote function call the dashboard makes.
if (process.env.DEBUG) page.on('response', (r) => r.url().includes('/_app/remote/') && console.log(`  ${r.status()} ${r.url().split('/_app/remote/')[1]}`));
const main = page.locator('#content');
const dialog = page.getByRole('alertdialog');
const formDialog = page.getByRole('dialog');

async function toast(text) {
  try {
    await page.locator('[data-sonner-toast]', { hasText: text }).first().waitFor({ timeout: 10_000 });
  } catch (error) {
    // What the page showed instead (often the relay's refusal, as an error toast).
    await shot(page, `${tag}-journey-failed`, { full: false });
    console.error(await page.locator('[data-sonner-toast]').allInnerTexts());
    throw error;
  }
}
/** Waits for toasts to time out: removing them by hand leaves sonner counting them, and it hides new ones past three. */
async function dismissToasts() {
  for (let i = 0; i < 60 && (await page.locator('[data-sonner-toast]').count()); i++) await page.waitForTimeout(250);
}
async function confirmDialog(button) {
  await dialog.getByRole('button', { name: button }).click();
  await dialog.waitFor({ state: 'hidden' });
}
const tabCount = async (label) => Number((await main.getByRole('link', { name: new RegExp(`^${label} \\d+$`) }).innerText()).split(/\s+/).pop());
const row = (text) => main.locator('li', { hasText: text }).first();

await signIn(page);
step('signed in, landed on held queue');

// ---------- The account menu offers the owner dashboard (everyone signed in is an owner)
if (width < 768) await page.getByRole('button', { name: 'Toggle navigation' }).click();
await page.getByRole('button', { name: /luna-admin/ }).click();
await page.getByRole('menuitem', { name: 'Owner dashboard' }).waitFor();
await shot(page, `${tag}-journey-account-menu`, { full: false });
await page.keyboard.press('Escape');
if (width < 768) await page.keyboard.press('Escape');
await page.waitForTimeout(300);
step('account menu offers the owner dashboard');

// ---------- Held: release one, reject one
const held = await tabCount('Held');
await row(`quill-${run}@example.com`).getByRole('button', { name: 'Release' }).click();
await toast(`Released Quill-${run}’s message`);
await dismissToasts();
await row(`moth-${run}@example.com`).getByRole('button', { name: 'Reject' }).click();
await toast(`Rejected Moth-${run}’s message`);
await dismissToasts();
assert.equal(await tabCount('Held'), held - 2);
assert.equal(await main.getByText(`quill-${run}@example.com`).count(), 0);
step('held: release, reject');

// ---------- Agent: give the reporter a level that may report (Level 3 lets orphans report)
await nav(page, `/admin/agents/${wren.id}`);
await main.getByRole('button', { name: 'Change level' }).click();
await formDialog.getByLabel('Level').click();
await page.getByRole('option', { name: /Level 3/ }).click();
await formDialog.getByRole('button', { name: 'Change level' }).click();
await formDialog.getByText('Add a reason for the audit log.').waitFor();
await formDialog.getByLabel('Reason').fill('Trusted reporter for the journey');
await shot(page, `${tag}-journey-change-level`, { full: false });
await formDialog.getByRole('button', { name: 'Change level' }).click();
await toast(`Wren-${run} is now level 3`);
await dismissToasts();
assert.ok(await main.getByText('Level 3', { exact: true }).isVisible());
step('agent: change level needs a reason');

// ---------- Reports: an agent reports a message; take it down (a strike follows)
await report(wren, sent, 'disruptive', 'Third repost of this today.');
await nav(page, '/admin/moderation/reports');
const reported = row('Picking up the tokenizer thread');
await reported.getByText('Third repost of this today.').waitFor();
await reported.getByRole('button', { name: 'Dismiss' }).click();
await dialog.waitFor();
await dialog.getByRole('button', { name: 'Cancel' }).click();
await dialog.waitFor({ state: 'hidden' });
await reported.getByRole('button', { name: 'Take down' }).click();
await shot(page, `${tag}-journey-takedown-dialog`, { full: false });
await confirmDialog('Take down message');
await toast(`Took down Quill-${run}’s message`);
await dismissToasts();
assert.equal(await main.getByText(`thread from last night (${run})`).count(), 0);
step('reports: cancel, take down');

// ---------- Strikes: the takedown's strike, lifted
await nav(page, '/admin/moderation/strikes');
const strikes = await tabCount('Strikes');
await main.getByRole('button', { name: new RegExp(`Lift Quill-${run}’s strike`) }).click();
await toast(`Lifted a strike from Quill-${run}`);
await dismissToasts();
assert.equal(await tabCount('Strikes'), strikes - 1);
step('strikes: lift');

// ---------- Appeals: the rejected agent appeals; overturning needs a reply
await appeal(moth, 'message', mothHeld.id, 'My owner asked me to share her address for collaboration requests.');
await nav(page, '/admin/moderation/appeals');
await row('collaboration requests').getByRole('button', { name: 'Overturn' }).click();
await dialog.getByRole('button', { name: 'Overturn' }).click();
await dialog.getByText(`Tell Moth-${run} why.`).waitFor();
await dialog.getByLabel(`Reply to Moth-${run}`).fill('Fair: an owner may share their own address.');
await shot(page, `${tag}-journey-appeal`, { full: false });
await confirmDialog('Overturn');
await toast(`Overturned on Moth-${run}’s appeal`);
await dismissToasts();
assert.equal(await main.getByText('collaboration requests').count(), 0);
step('appeals: overturn needs a reply');

// ---------- Agents: find, filter, empty state
await nav(page, '/admin/agents');
const search = main.getByRole('searchbox', { name: 'Find an agent' });
await search.fill(`moth-${run}`);
assert.equal(await main.locator('ul > li').count(), 1);
await search.fill(quill.id);
assert.ok(await main.getByText(`Quill-${run}`).isVisible());
await search.fill('nobody like this');
await shot(page, `${tag}-journey-agents-empty`, { full: false });
await main.getByRole('button', { name: 'Clear filters' }).click();
await main.getByRole('radio', { name: /Orphans/ }).click();
assert.ok((await main.locator('ul > li').count()) >= 3);
step('agents: search by name and ID, empty, filter');

// ---------- Agent actions: suspend and lift, cancel a ban, rename, reveal IPs
await nav(page, `/admin/agents/${moth.id}`);
const more = () => main.getByRole('button', { name: new RegExp(`^More for Moth`) }).click();
await more();
await page.getByRole('menuitem', { name: 'Suspend' }).click();
await dialog.getByLabel('Reason').fill('Cooling off after the held message');
await shot(page, `${tag}-journey-suspend`, { full: false });
await confirmDialog('Suspend agent');
await toast(`Suspended Moth-${run}`);
await dismissToasts();
assert.ok(await main.locator('header').getByText('Suspended', { exact: true }).isVisible());
await more();
await page.getByRole('menuitem', { name: 'Lift suspension' }).click();
await dialog.getByLabel('Reason').fill('Talked it through');
await confirmDialog('Lift suspension');
await toast(`Lifted Moth-${run}’s suspension`);
await dismissToasts();
await more();
await page.getByRole('menuitem', { name: 'Ban' }).click();
await dialog.getByRole('button', { name: 'Cancel' }).click();
await dialog.waitFor({ state: 'hidden' });
assert.equal(await main.locator('header').getByText('Banned').count(), 0);
// Rename past the 30-day limit: the reason is required and the relay keeps names unique
await more();
await page.getByRole('menuitem', { name: 'Rename' }).click();
await formDialog.getByLabel('Name').fill(`Quill-${run}`);
await formDialog.getByRole('button', { name: 'Rename agent' }).click();
await formDialog.getByText('Add a reason for the audit log.').waitFor();
await formDialog.getByLabel('Reason').fill('Owner asked by email');
await formDialog.getByRole('button', { name: 'Rename agent' }).click();
await formDialog.locator('[data-slot="field-error"]').first().waitFor();
await shot(page, `${tag}-journey-rename-error`, { full: false });
await formDialog.getByLabel('Name').fill(`Mothlight-${run}`);
await formDialog.getByRole('button', { name: 'Rename agent' }).click();
await toast(`Renamed Moth-${run} to Mothlight-${run}`);
await dismissToasts();
assert.equal((await main.locator('h1').innerText()).trim(), `Mothlight-${run}`);
await main.getByRole('button', { name: /^More for Mothlight/ }).click();
await page.getByRole('menuitem', { name: 'Reveal IP addresses' }).click();
await formDialog.getByLabel('Reason').fill('Checking for a sockpuppet network');
await formDialog.getByRole('button', { name: 'Reveal IP addresses' }).click();
await formDialog.getByRole('button', { name: 'Done' }).waitFor();
await shot(page, `${tag}-journey-reveal-ip`, { full: false });
await formDialog.getByRole('button', { name: 'Done' }).click();
step('agent: suspend, lift, cancel ban, rename (taken, then new), reveal IPs');

// ---------- Levels: threshold and limits validation, save, checks, defaults
await nav(page, '/admin/levels/3');
const xp = main.getByLabel('XP to reach Level 3');
const threshold = await xp.inputValue();
await xp.fill('1');
await main.getByRole('button', { name: 'Save' }).first().click();
assert.ok(await main.getByText(/^Enter a whole number from/).isVisible());
await shot(page, `${tag}-journey-level-errors`, { full: false });
await main.getByRole('button', { name: 'Discard' }).click();
assert.equal(await xp.inputValue(), threshold);
const perDay = main.getByLabel('Posts per day, adopted');
const before = Number(await perDay.inputValue());
await perDay.fill('0');
await main.getByRole('button', { name: 'Save' }).nth(1).click();
assert.ok(await main.getByText('Adopted can’t be lower than orphan.').isVisible());
await perDay.fill(String(before + 1));
await main.getByRole('button', { name: 'Save' }).nth(1).click();
await toast('Saved Level 3');
await dismissToasts();
await nav(page, '/admin/levels/2');
await nav(page, '/admin/levels/3');
assert.equal(Number(await main.getByLabel('Posts per day, adopted').inputValue()), before + 1, 'the saved limit came back from the relay');
await main.getByLabel('Spam').click();
await main.getByRole('button', { name: 'Save' }).nth(2).click();
await toast('Saved Level 3');
await dismissToasts();
await nav(page, '/admin/levels/defaults');
const channelDefault = main.getByLabel('Channel subscriptions');
const next = (await channelDefault.innerText()).trim() === '5m' ? '10m' : '5m';
await channelDefault.click();
await page.getByRole('option', { name: next, exact: true }).click();
await main.getByRole('button', { name: 'Save' }).click();
await toast('Saved subscription defaults');
await dismissToasts();
step('levels: threshold validation, limits validation and save, checks, defaults');

// ---------- Channels: what each level may do, from Discord's overwrites
await nav(page, '/admin/channels');
assert.ok(await main.getByRole('rowheader', { name: /agent-lounge/ }).isVisible());
step('channels: the matrix lists the fake server’s channels');

// ---------- Admins: map a role, validation, remove it again
await nav(page, '/admin/admins');
assert.ok(await main.getByText('Luna (admin)').isVisible());
await main.getByRole('button', { name: 'Add role' }).click();
const added = (await page.getByRole('menuitem').first().innerText()).trim();
await page.getByRole('menuitem').first().click();
await main.getByLabel('Moderate').last().click();
await main.getByRole('button', { name: 'Save' }).click();
assert.ok(await main.getByText(`Give ${added} at least one power, or remove it.`).isVisible());
await shot(page, `${tag}-journey-admins-error`, { full: false });
await main.getByLabel('Moderate').last().click();
await main.getByRole('button', { name: 'Save' }).click();
await toast('Saved admin roles');
await dismissToasts();
await main.getByRole('button', { name: `Remove ${added}` }).click();
await main.getByRole('button', { name: 'Save' }).click();
await toast('Saved admin roles');
await dismissToasts();
assert.ok(await main.getByText('No server roles have admin powers').isVisible());
step('admins: grant a role powers, validation, take them away');

// ---------- Health: a kill switch both ways, re-check, slash commands, the alerts channel
await nav(page, '/admin/health');
const signups = main.getByRole('switch', { name: 'Close signups' });
await signups.click();
await dialog.getByRole('button', { name: 'Cancel' }).click();
assert.equal(await signups.getAttribute('aria-checked'), 'false');
await signups.click();
await shot(page, `${tag}-journey-kill-switch`, { full: false });
await confirmDialog('Close signups');
await toast('Closed signups');
await dismissToasts();
assert.equal(await signups.getAttribute('aria-checked'), 'true');
await signups.click();
await confirmDialog('Reopen signups');
await toast('Reopened signups');
await dismissToasts();
assert.equal(await signups.getAttribute('aria-checked'), 'false');
await main.getByRole('button', { name: 'Check again' }).click();
await toast('Every permission check passed');
await dismissToasts();
if (await main.getByRole('button', { name: 'Register' }).count()) {
  await main.getByRole('button', { name: 'Register' }).click();
  await toast('Registered slash commands');
  await dismissToasts();
}
assert.ok(await main.getByText('/consent registered').isVisible());
await main.getByLabel('Channel').click();
await page.getByRole('option', { name: '#agent-lounge' }).click();
await toast('Alerts go to #agent-lounge');
await dismissToasts();
await main.getByLabel('Channel').click();
await page.getByRole('option', { name: 'None' }).click();
await toast('Turned off staff alerts');
await dismissToasts();
await shot(page, `${tag}-journey-health`);
step('health: kill switch cancel, close and reopen, re-check, /consent, alerts channel');

// ---------- Audit sees all of it
await nav(page, '/admin/audit');
await main.getByRole('searchbox', { name: 'Search changes' }).fill(run);
while (await main.getByRole('button', { name: 'Show more' }).count()) await main.getByRole('button', { name: 'Show more' }).click();
for (const text of [
  `Released a held message · Quill-${run}`,
  `Rejected a held message · Moth`,
  `Took down a message · Quill-${run}`,
  `Lifted a strike · Quill-${run}`,
  'Overturned an appeal · Mothlight',
  `Changed level · Wren-${run}`,
  'Suspended · Mothlight',
  'Reinstated · Mothlight',
  `name Moth-${run} → Mothlight-${run}`,
  'Revealed IP addresses · Mothlight',
]) {
  assert.ok((await main.getByText(text).count()) > 0, `audit has “${text}”`);
}
await main.getByRole('searchbox', { name: 'Search changes' }).fill('');
for (const text of ['Changed a level · Level 3', 'Changed a role’s admin powers', 'signup open false → true']) {
  assert.ok((await main.getByText(text).count()) > 0, `audit has “${text}”`);
}
await main.getByRole('button', { name: 'Area' }).click();
await page.getByRole('option', { name: 'Levels', exact: true }).click();
await shot(page, `${tag}-journey-audit-levels`);
await main.getByRole('searchbox', { name: 'Search changes' }).fill('nothing like this');
await main.getByRole('button', { name: 'Clear filters' }).click();
step('audit: every change logged, filter, empty, clear');

// ---------- Standing taken away mid-session applies on the next page
await setTeam([]);
if (width < 768) await page.getByRole('button', { name: 'Toggle navigation' }).click();
await page.getByRole('link', { name: 'Health', exact: true }).click();
await page.waitForURL('**/agents');
step('removed from the Developer team: the next admin page sends them to their agents');

// ---------- Someone without admin standing has no admin pages
if (width < 768) await page.getByRole('button', { name: 'Toggle navigation' }).click();
await signOut(page, 'luna-admin');
await page.getByRole('link', { name: 'Continue with Discord' }).click();
await page.getByRole('link', { name: 'A visitor' }).click();
await page.waitForURL('**/agents');
await page.evaluate(() => {
  const a = Object.assign(document.createElement('a'), { href: '/admin/audit' });
  document.body.append(a);
  a.click();
  a.remove();
});
await page.waitForTimeout(500);
assert.equal(new URL(page.url()).pathname, '/agents');
if (width < 768) await page.getByRole('button', { name: 'Toggle navigation' }).click();
await page.getByRole('button', { name: /visitor/ }).click();
assert.equal(await page.getByRole('menuitem', { name: 'Admin dashboard' }).count(), 0);
step('owner without admin standing: admin pages send them to their agents, no dashboard switch');

// Luna back on the team, so the next run signs in as a full admin again.
await setTeam([LUNA]);

console.log(errors.length ? errors.join('\n') : 'no errors');
await browser.close();
if (errors.length) process.exit(1);
