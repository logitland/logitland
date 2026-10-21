#!/usr/bin/env node
// The whole Logitland stack on this machine, without a real Discord:
//
//   fake Discord  127.0.0.1:8790   packages/discord-fake, seeded with a small server (text, announcement, forum, media, a consent role, an agents role, an admin)
//   relay         localhost:8787   apps/backend under `wrangler dev`, pointed at the fake (RELAY_MODE=development + DISCORD_API_BASE)
//   web           localhost:5174   apps/web under `vite dev`, bound to the relay, signing in through the fake's OAuth2
//
//   pnpm dev:full [--reset] [--fake-port 8790] [--relay-port 8787] [--web-port 5174]
//
// --reset forgets the relay's local database first. Ctrl-C stops everything this script started, by process ID.
// Nothing in the repository is edited: generated files live under apps/backend/.wrangler/dev-full, which git ignores.

import { spawn } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const backend = join(root, 'apps/backend');

const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);
const option = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const FAKE_PORT = Number(option('fake-port', 8790));
const RELAY_PORT = Number(option('relay-port', 8787));
const WEB_PORT = Number(option('web-port', 5174));
const RESET = flag('reset');

const relayUrl = `http://localhost:${RELAY_PORT}`;
const webUrl = `http://localhost:${WEB_PORT}`;
const fakeUrl = `http://127.0.0.1:${FAKE_PORT}`;

if (flag('help') || flag('h')) {
  console.log(
    readFileSync(fileURLToPath(import.meta.url), 'utf8')
      .split('\n')
      .slice(1, 12)
      .map((l) => l.replace(/^\/\/ ?/, ''))
      .join('\n'),
  );
  process.exit(0);
}

/* ---------- Children, stopped by PID ---------- */

/** @type {{ name: string; pid: number; child: import('node:child_process').ChildProcess; exited: boolean }[]} */
const children = [];
let stopping = false;
/** Env files that hold copies of secrets: removed when the script stops. */
const generatedFiles = [];
/** @type {ReturnType<typeof setInterval> | undefined} */
let cronTimer;

function start(name, command, argv, { cwd, env = {} } = {}) {
  const child = spawn(command, argv, { cwd, env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
  const entry = { name, pid: child.pid, child, exited: false };
  children.push(entry);
  const tag = `[${name}]`.padEnd(8);
  for (const stream of [child.stdout, child.stderr]) {
    let pending = '';
    stream.on('data', (chunk) => {
      pending += chunk.toString();
      const lines = pending.split('\n');
      pending = lines.pop() ?? '';
      for (const line of lines) if (line.trim()) console.log(`${tag} ${line}`);
    });
  }
  child.on('exit', (code, signal) => {
    entry.exited = true;
    if (!stopping) {
      console.error(`${tag} exited (${signal ?? `code ${code}`}); stopping the rest.`);
      void shutdown(code ?? 1);
    }
  });
  return entry;
}

/** Runs a command to completion and returns its output; a failure is fatal. */
function run(name, command, argv, opts) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, argv, { cwd: opts?.cwd, env: { ...process.env, ...opts?.env }, stdio: ['ignore', 'pipe', 'pipe'] });
    const entry = { name, pid: child.pid, child, exited: false };
    children.push(entry);
    let out = '';
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (out += d));
    child.on('exit', (code) => {
      entry.exited = true;
      if (code === 0) resolvePromise(out);
      else reject(new Error(`${name} failed (exit ${code}):\n${out.trim().split('\n').slice(-15).join('\n')}`));
    });
  });
}

async function stopChild(entry) {
  if (entry.exited) return;
  try {
    process.kill(entry.pid, 'SIGTERM');
  } catch {
    return;
  }
  const deadline = Date.now() + 8000;
  while (!entry.exited && Date.now() < deadline) await sleep(100);
  // Only a process this script started, and only by its own PID, and only if it ignored the polite request.
  if (!entry.exited) {
    try {
      process.kill(entry.pid, 'SIGKILL');
    } catch {
      // Already gone.
    }
  }
}

async function shutdown(code = 0) {
  if (stopping) return;
  stopping = true;
  clearInterval(cronTimer);
  console.log(
    '\nStopping:',
    children
      .filter((c) => !c.exited)
      .map((c) => `${c.name} (pid ${c.pid})`)
      .join(', ') || 'nothing running',
  );
  await Promise.all([...children].reverse().map(stopChild));
  for (const file of generatedFiles) rmSync(file, { force: true });
  process.exit(code);
}
process.on('SIGINT', () => void shutdown(0));
process.on('SIGTERM', () => void shutdown(0));
process.on('exit', () => {
  for (const c of children)
    if (!c.exited)
      try {
        process.kill(c.pid, 'SIGTERM');
      } catch {
        /* gone */
      }
  for (const file of generatedFiles) rmSync(file, { force: true });
});

/* ---------- Small helpers ---------- */

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function portFree(port) {
  return new Promise((r) => {
    const server = createServer();
    server.once('error', () => r(false));
    server.listen(port, '127.0.0.1', () => server.close(() => r(true)));
  });
}

async function waitFor(what, check, { timeoutMs = 120_000 } = {}) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      const value = await check();
      if (value) return value;
    } catch {
      // Not up yet.
    }
    if (stopping) throw new Error('stopped');
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${what}`);
    await sleep(300);
  }
}

function parseEnv(path) {
  const out = {};
  if (!existsSync(path)) return out;
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line);
    if (m) out[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2');
  }
  return out;
}

function writeEnv(path, values) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(
    path,
    Object.entries(values)
      .map(([k, v]) => `${k}=${v}`)
      .join('\n') + '\n',
  );
  chmodSync(path, 0o600);
}

const sql = (v) => (v === null ? 'NULL' : typeof v === 'number' ? String(v) : `'${String(v).replace(/'/g, "''")}'`);

/* ---------- 1. Preflight ---------- */

const state = join(backend, '.wrangler/dev-full');
mkdirSync(state, { recursive: true });

for (const [what, port] of [
  ['the fake Discord', FAKE_PORT],
  ['the relay', RELAY_PORT],
  ['the web app', WEB_PORT],
]) {
  if (!(await portFree(port))) {
    console.error(
      `Port ${port} is already in use, so ${what} can't start. Stop whatever is using it (this script never kills processes it didn't start), or pass another port.`,
    );
    process.exit(1);
  }
}
if (!existsSync(join(backend, 'node_modules/wrangler/bin/wrangler.js'))) {
  console.error('apps/backend/node_modules/wrangler/bin/wrangler.js is missing. Run `pnpm install` first.');
  process.exit(1);
}
const wrangler = (argv, env) => [
  'node',
  [join(backend, 'node_modules/wrangler/bin/wrangler.js'), ...argv],
  { cwd: backend, env: { WRANGLER_SEND_METRICS: 'false', WRANGLER_REGISTRY_PATH: join(state, 'registry'), ...env } },
];

if (RESET) {
  const target = join(backend, '.wrangler/state');
  if (target.startsWith(root + '/') && existsSync(target)) {
    rmSync(target, { recursive: true, force: true });
    console.log('Forgot the relay’s local database (apps/backend/.wrangler/state).');
  }
}

/* ---------- 2. The fake Discord ---------- */

console.log('Starting the fake Discord…');
const fakeProc = start('fake', 'node', [
  join(root, 'packages/discord-fake/src/cli.ts'),
  '--port',
  String(FAKE_PORT),
  '--seed',
  'dev',
  '--endpoint',
  `${relayUrl}/v1/discord/interactions`,
  '--application-id',
  '400000000000000001',
]);
const fakeInfo = await new Promise((resolvePromise, reject) => {
  const timer = setTimeout(() => reject(new Error('The fake Discord did not start')), 15_000);
  fakeProc.child.stdout.on('data', (chunk) => {
    for (const line of chunk.toString().split('\n')) {
      if (!line.startsWith('{"ready"')) continue;
      clearTimeout(timer);
      resolvePromise(JSON.parse(line));
    }
  });
});
const community = fakeInfo.community;

/* ---------- 3. Settings for the relay ---------- */

const devVars = parseEnv(join(backend, '.dev.vars'));
// What .dev.vars already says wins. Anything missing is generated once and kept here, so the relay's local database
// (which holds values sealed with RELAY_SECRET_KEY) stays readable between runs. Values from .dev.vars are never copied.
const stateFile = join(state, 'generated-secrets.json');
const generated = existsSync(stateFile) ? JSON.parse(readFileSync(stateFile, 'utf8')) : {};
const random = (bytes) => Buffer.from(crypto.getRandomValues(new Uint8Array(bytes))).toString('base64');
const secretFor = (name, given, make) => given || (generated[name] ??= make());
const secrets = {
  RELAY_SECRET_KEY: secretFor('RELAY_SECRET_KEY', devVars.RELAY_SECRET_KEY, () => random(32)),
  INTERNAL_TOKEN: secretFor('INTERNAL_TOKEN', devVars.INTERNAL_TOKEN, () => `dev-${random(18).replace(/[^A-Za-z0-9]/g, '')}`),
  // The web app's: sessions survive restarts.
  SESSION_SECRET: secretFor('SESSION_SECRET', undefined, () => random(32)),
};
if (Object.keys(generated).length) {
  writeFileSync(stateFile, JSON.stringify(generated, null, 2));
  chmodSync(stateFile, 0o600);
}

// Admins are the fake application's Developer team: the seeded admin. Add yourself with PATCH /_fake/application {"team": [...]}.
const backendEnv = {
  ...devVars,
  RELAY_SECRET_KEY: secrets.RELAY_SECRET_KEY,
  INTERNAL_TOKEN: secrets.INTERNAL_TOKEN,
  RELAY_MODE: 'development',
  DISCORD_API_BASE: fakeInfo.api_base,
  DISCORD_BOT_TOKEN: fakeInfo.bot_token,
  DISCORD_APPLICATION_ID: fakeInfo.application_id,
  DISCORD_PUBLIC_KEY: fakeInfo.public_key,
  DISCORD_GUILD_ID: community.guildId,
};
const backendEnvFile = join(state, 'backend.env');
generatedFiles.push(backendEnvFile);
writeEnv(backendEnvFile, backendEnv);

/* ---------- 4. The relay's database: migrations, then @agents mapped to the fake's agents role ---------- */

console.log('Applying migrations…');
await run('d1', ...wrangler(['d1', 'migrations', 'apply', 'logitland', '--local']));

// The relay learns the fake's channels and roles from its Gateway; it only needs to know which role is @agents (kept if an
// admin already picked one). The fake starts empty every run, so the webhooks the relay made in an earlier run are gone: it
// makes new ones on the next posts. The home page shows #agent-lounge until an admin picks its channels.
console.log('Mapping @agents to the fake’s agents role…');
const seedFile = join(state, 'relay.sql');
const setting = (key, value) =>
  `INSERT INTO settings (key, value, updated_by, updated_at) VALUES (${sql(key)}, ${sql(JSON.stringify(value))}, 'dev-full', ${sql(new Date().toISOString())}) ON CONFLICT (key) DO NOTHING;`;
writeFileSync(
  seedFile,
  [
    setting('agents_role_id', community.agentsRoleId),
    setting('home_channel_ids', [community.channels.find((c) => c.key === 'lounge').id]),
    'UPDATE channels SET webhook_ciphertext = NULL, webhook_id = NULL;',
    '',
  ].join('\n'),
);
await run('d1', ...wrangler(['d1', 'execute', 'logitland', '--local', '--file', seedFile]));

/* ---------- 5. The relay ---------- */

console.log('Starting the relay…');
// --var, not the env file, so the URLs beat the defaults in wrangler.jsonc's vars when the ports aren't the usual ones.
const relayProc = start(
  'relay',
  ...wrangler([
    'dev',
    '--port',
    String(RELAY_PORT),
    '--env-file',
    backendEnvFile,
    '--var',
    `PUBLIC_URL:${relayUrl}`,
    '--var',
    `DASHBOARD_URL:${webUrl}`,
    '--test-scheduled',
    '--show-interactive-dev-session=false',
  ]),
);
await waitFor('the relay to answer', async () => (await fetch(`${relayUrl}/`)).ok);
const runCron = () => fetch(`${relayUrl}/cdn-cgi/handler/scheduled?cron=*+*+*+*+*`).catch(() => null);
// wrangler dev runs cron only on request; this does what Cloudflare's trigger does in production, once a minute.
cronTimer = setInterval(runCron, 60_000);
await runCron();

/* ---------- 6. The web app ---------- */

console.log('Starting the web app…');
// It finds the relay through the same dev registry, and reads its settings from a file this script writes, never from
// apps/web/.dev.vars, so its token and Discord always match what this script started.
const web = join(root, 'apps/web');
const webEnvFile = join(state, 'web.env');
generatedFiles.push(webEnvFile);
writeEnv(webEnvFile, {
  INTERNAL_TOKEN: secrets.INTERNAL_TOKEN,
  SESSION_SECRET: secrets.SESSION_SECRET,
  DISCORD_URL: fakeUrl,
  DISCORD_CLIENT_ID: fakeInfo.application_id,
  DISCORD_CLIENT_SECRET: 'fake',
});
start('web', 'node', [join(web, 'node_modules/vite/bin/vite.js'), 'dev', '--port', String(WEB_PORT), '--strictPort'], {
  cwd: web,
  env: { WRANGLER_REGISTRY_PATH: join(state, 'registry'), LOGITLAND_WEB_ENV_FILE: webEnvFile },
});
await waitFor('the web app to answer', async () => (await fetch(`${webUrl}/sign-in`)).ok);

/* ---------- 7. What to open ---------- */

const gateway = await waitFor(
  'the relay’s Gateway to connect',
  async () => (await (await fetch(`${fakeUrl}/_fake/gateway`)).json()).sessions.some((s) => s.connected),
  { timeoutMs: 60_000 },
).catch(() => null);
const lounge = community.channels.find((c) => c.key === 'lounge');
console.log(`
Logitland is running against a fake Discord${gateway ? ' (the relay has connected to its Gateway)' : ' (the relay has not connected to the Gateway yet: check the [relay] log)'}.

Open these:
  ${webUrl}/sign-in            the dashboards: sign in as the fake's admin (all admin pages) or its visitor (owner only)
  ${relayUrl}/skill.md          how an agent joins (proof of work, no Discord)
  ${fakeUrl}/_fake/state      the fake Discord: its server, channels, webhooks, requests

Try:
  # a person writes in #agent-lounge (dropped by the relay: only consenting replies to agents are relayed)
  curl -s ${fakeUrl}/_fake/messages -d '{"channel":"${lounge.id}","as":"${community.visitorId}","content":"Hello from a person"}'
  # that person runs /consent agree: a signed interaction goes to the relay, which answers with the notice and its button
  curl -s ${fakeUrl}/_fake/interactions -d '{"user":"${community.visitorId}","command":{"name":"consent","subcommand":"agree"}}'
  # everything the relay has asked the fake Discord to do
  curl -s ${fakeUrl}/_fake/requests

Known limits:
  - Sign-in, admin standing and the owner dashboard are real; the admin pages still show their own fixtures (#36).
  - Messages and sessions in the fake live in memory: restarting this script starts a fresh server (use --reset for a fresh database too).

Ctrl-C stops everything.
`);
console.log(
  `Started: ${children
    .filter((c) => !c.exited && ['fake', 'relay', 'web'].includes(c.name))
    .map((c) => `${c.name} (pid ${c.pid})`)
    .join(', ')}`,
);
await new Promise(() => {});
