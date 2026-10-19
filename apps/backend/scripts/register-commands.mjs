#!/usr/bin/env node
// Registers the /mirror command in the Logitland guild. Run it once after creating the application, and again
// whenever the command definitions below change:
//
//   DISCORD_APPLICATION_ID=… DISCORD_GUILD_ID=… DISCORD_BOT_TOKEN=… node scripts/register-commands.mjs
//   node scripts/register-commands.mjs --dry-run     # print what would be sent; needs no environment and sends nothing
//
// This is a bulk overwrite: Discord replaces every guild command this application has with the list below.
// The same definition lives in packages/relay/src/services/interactions.ts (MIRROR_COMMAND), which the setup page's
// “Register /mirror” button sends; a relay test runs this script against a local server and compares the two.
// DISCORD_API_BASE exists only for that test (default https://discord.com/api/v10).
// https://docs.discord.com/developers/interactions/application-commands#bulk-overwrite-guild-application-commands

const SUB_COMMAND = 1;

const commands = [
  {
    name: 'mirror',
    type: 1,
    description: 'Join or leave the Logitland public mirror',
    options: [
      { type: SUB_COMMAND, name: 'agree', description: 'See what the public mirror shares and with whom, then agree to get the role that lets you chat' },
      { type: SUB_COMMAND, name: 'leave', description: 'Leave the public mirror, lose the chat role and have what Logitland holds of yours deleted' },
      { type: SUB_COMMAND, name: 'status', description: 'See whether you have agreed and how many of your messages are on the mirror' },
    ],
  },
];

if (process.argv.includes('--dry-run')) {
  console.log(JSON.stringify(commands, null, 2));
  console.log('\nDry run: nothing was sent to Discord.');
  process.exit(0);
}

const env = Object.fromEntries(['DISCORD_APPLICATION_ID', 'DISCORD_GUILD_ID', 'DISCORD_BOT_TOKEN'].map((name) => [name, process.env[name]?.trim()]));
const missing = Object.entries(env)
  .filter(([, value]) => !value)
  .map(([name]) => name);
if (missing.length) {
  console.error(`Set ${missing.join(', ')} in the environment and run again.`);
  process.exit(1);
}
for (const name of ['DISCORD_APPLICATION_ID', 'DISCORD_GUILD_ID']) {
  if (!/^\d{17,20}$/.test(env[name])) {
    console.error(`${name} should be a Discord ID: 17 to 20 digits.`);
    process.exit(1);
  }
}

const base = process.env.DISCORD_API_BASE?.trim() || 'https://discord.com/api/v10';
const url = `${base}/applications/${env.DISCORD_APPLICATION_ID}/guilds/${env.DISCORD_GUILD_ID}/commands`;
let res;
try {
  res = await fetch(url, {
    method: 'PUT',
    headers: {
      authorization: `Bot ${env.DISCORD_BOT_TOKEN}`,
      'content-type': 'application/json',
      'user-agent': 'DiscordBot (https://github.com/logitsml/logitland, 0.1)',
    },
    body: JSON.stringify(commands),
    signal: AbortSignal.timeout(15_000),
  });
} catch (err) {
  console.error(`Couldn’t reach Discord: ${err instanceof Error ? err.message : err}`);
  process.exit(1);
}

if (!res.ok) {
  const detail = await res.json().catch(() => ({}));
  console.error(`Discord refused the commands (HTTP ${res.status}${detail.code ? `, code ${detail.code}` : ''}): ${detail.message ?? 'no details'}`);
  if (detail.errors) console.error(JSON.stringify(detail.errors, null, 2));
  if (res.status === 401) console.error('Check DISCORD_BOT_TOKEN.');
  if (res.status === 403 || res.status === 404)
    console.error('Check that the bot is in this server, was invited with the applications.commands scope, and that the IDs are right.');
  process.exit(1);
}

const registered = await res.json();
console.log(`Registered ${registered.length} command${registered.length === 1 ? '' : 's'} in guild ${env.DISCORD_GUILD_ID}:`);
for (const cmd of registered) {
  const subs = (cmd.options ?? []).filter((o) => o.type === SUB_COMMAND).map((o) => o.name);
  console.log(`  /${cmd.name}${subs.length ? ` (${subs.join(', ')})` : ''}  id ${cmd.id}`);
}
