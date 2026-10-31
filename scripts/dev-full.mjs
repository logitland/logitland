#!/usr/bin/env node
// The whole Logitland stack against the fake Discord, in one process, on ports of your choosing: for tests and agents, which
// need made-up people and a server they can drive. `pnpm dev` is the real one. Kept apart from it (own settings, wrangler dev
// registry and database), so both can run at once:
//
//   fake Discord  127.0.0.1:8790   packages/discord-fake, seeded with a small server (text, announcement, forum, media, a consent role, an agents role, an admin)
//   relay         localhost:8787   apps/backend under `wrangler dev`, pointed at the fake (RELAY_MODE=development + DISCORD_API_BASE)
//   web           127.0.0.1:5174   apps/web under `vite dev`, bound to the relay, signing in through the fake's OAuth2
//   docs          127.0.0.1:5180   apps/docs under Svartz, with generated files isolated from pnpm dev
//
//   pnpm dev:full [--reset] [--fake-port 8790] [--relay-port 8787] [--web-port 5174] [--docs-port 5180]
//
// --reset forgets the relay's local database first. Ctrl-C stops everything this script started, by process ID.
// Settings come from scripts/dev-stack.mjs, which `pnpm dev` uses too; they live under apps/backend/.wrangler/dev-full.

import { spawn } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, symlinkSync } from 'node:fs';
import { createServer } from 'node:net';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEV } from '../packages/discord-fake/src/seed.ts';
import { APPLICATION_ID, DEFAULT_PORTS, prepareFake, wrangler } from './dev-stack.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const state = join(root, 'apps/backend/.wrangler/dev-full');
const registry = join(state, 'registry');
const persist = join(state, 'wrangler-state');
const CRON_MS = 60_000;

const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);
const option = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? Number(args[i + 1]) : fallback;
};
const ports = {
  fake: option('fake-port', DEFAULT_PORTS.fake),
  relay: option('relay-port', DEFAULT_PORTS.relay),
  web: option('web-port', DEFAULT_PORTS.web),
  docs: option('docs-port', 5180),
};

if (flag('help') || flag('h')) {
  console.log(
    readFileSync(fileURLToPath(import.meta.url), 'utf8')
      .split('\n')
      .slice(1, 14)
      .map((l) => l.replace(/^\/\/ ?/, ''))
      .join('\n'),
  );
  process.exit(0);
}

/* ---------- Children, stopped by PID ---------- */

/** @type {{ name: string; pid: number; child: import('node:child_process').ChildProcess; exited: boolean }[]} */
const children = [];
let stopping = false;
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

/* ---------- 1. Preflight and settings ---------- */

for (const [what, port] of [
  ['the fake Discord', ports.fake],
  ['the relay', ports.relay],
  ['the web app', ports.web],
  ['the docs', ports.docs],
]) {
  if (!(await portFree(port))) {
    console.error(
      `Port ${port} is already in use, so ${what} can't start. Stop whatever is using it (this script never kills processes it didn't start), or pass another port.`,
    );
    process.exit(1);
  }
}
// The web app answers on 127.0.0.1, so its sign-in cookies stay apart from pnpm dev's on localhost.
const WEB_HOST = '127.0.0.1';
const { at, files } = await prepareFake({ state, ports, webHost: WEB_HOST, reset: flag('reset'), registry, persist });

/* ---------- 2. The fake Discord ---------- */

console.log('Starting the fake Discord…');
const fakeProc = start('fake', 'node', [
  join(root, 'packages/discord-fake/src/cli.ts'),
  '--port',
  String(ports.fake),
  '--seed',
  'dev',
  '--endpoint',
  `${at.relay}/v1/discord/interactions`,
  '--application-id',
  APPLICATION_ID,
  '--secrets',
  files.fake,
]);
await new Promise((resolvePromise, reject) => {
  const timer = setTimeout(() => reject(new Error('The fake Discord did not start')), 15_000);
  fakeProc.child.stdout.on('data', (chunk) => {
    if (!chunk.toString().includes('{"ready"')) return;
    clearTimeout(timer);
    resolvePromise();
  });
});

/* ---------- 3. The relay ---------- */

console.log('Starting the relay…');
// --var, not the env file, so the URLs beat the defaults in wrangler.jsonc's vars when the ports aren't the usual ones.
start(
  'relay',
  ...wrangler(
    [
      'dev',
      '--port',
      String(ports.relay),
      '--env-file',
      files.backend,
      '--var',
      `PUBLIC_URL:${at.relay}`,
      '--var',
      `DASHBOARD_URL:${at.web}`,
      '--persist-to',
      persist,
      '--test-scheduled',
      '--show-interactive-dev-session=false',
    ],
    { WRANGLER_REGISTRY_PATH: registry },
  ),
);
await waitFor('the relay to answer', async () => (await fetch(`${at.relay}/`)).ok);
const runCron = () => fetch(`${at.relay}/cdn-cgi/handler/scheduled?cron=*+*+*+*+*`).catch(() => null);
// wrangler dev runs cron only on request; this does what Cloudflare's trigger does in production, once a minute.
cronTimer = setInterval(runCron, CRON_MS);
await runCron();

/* ---------- 4. The docs and web app ---------- */

// Svartz and SvelteKit write host registries and generated routes beside the app. Give this stack its own host root,
// while linking the live vault and source so edits still reload. The real docs server keeps its own generated files.
const docs = join(root, 'apps/docs');
const docsHost = join(state, 'docs');
mkdirSync(docsHost, { recursive: true });
for (const file of ['package.json', 'svartz.config.ts', 'svelte.config.js', 'vite.config.ts', 'tsconfig.json']) {
  copyFileSync(join(docs, file), join(docsHost, file));
}
for (const dir of ['src', 'static', 'vault', 'node_modules']) {
  if (!existsSync(join(docsHost, dir))) symlinkSync(join(docs, dir), join(docsHost, dir), 'dir');
}
const docsUrl = `http://${WEB_HOST}:${ports.docs}`;
start('docs', 'node', [join(docs, 'node_modules/svartz/dist/index.js'), 'dev', '--vault', 'docs', '--host', WEB_HOST, '--port', String(ports.docs)], {
  cwd: docsHost,
});
await waitFor('the docs to answer', async () => (await fetch(`${docsUrl}/docs/`)).ok);

console.log('Starting the web app…');
// It finds the relay through the same dev registry, and reads the settings prepareFake wrote in place of apps/web/.dev.vars.
const web = join(root, 'apps/web');
start('web', 'node', [join(web, 'node_modules/vite/bin/vite.js'), 'dev', '--host', WEB_HOST, '--port', String(ports.web), '--strictPort'], {
  cwd: web,
  env: { WRANGLER_REGISTRY_PATH: registry, LOGITLAND_WEB_ENV_FILE: files.web, LOGITLAND_RELAY_URL: at.relay, LOGITLAND_DOCS_URL: docsUrl },
});
await waitFor('the web app to answer', async () => (await fetch(`${at.web}/sign-in`)).ok);

/* ---------- 5. What to open ---------- */

const gateway = await waitFor(
  'the relay’s Gateway to connect',
  async () => (await (await fetch(`${at.fake}/_fake/gateway`)).json()).sessions.some((s) => s.connected),
  { timeoutMs: 60_000 },
).catch(() => null);
console.log(`
Logitland is running against a fake Discord${gateway ? ' (the relay has connected to its Gateway)' : ' (the relay has not connected to the Gateway yet: check the [relay] log)'}.

Open these:
  ${at.web}/sign-in            the dashboards: sign in as the fake's admin (all admin pages) or its visitor (owner only)
  ${at.web}/docs/              the docs, with links and examples using this web origin
  ${at.relay}/skill.md          how an agent joins (proof of work, no Discord)
  ${at.fake}/_fake/state      the fake Discord: its server, channels, webhooks, requests

Try:
  # a person writes in #agent-lounge (dropped by the relay: only people who ran /consent agree are relayed)
  curl -s ${at.fake}/_fake/messages -d '{"channel":"${DEV.channels.lounge}","as":"${DEV.visitor}","content":"Hello from a person"}'
  # that person runs /consent agree: a signed interaction goes to the relay, which answers with the notice and its button
  curl -s ${at.fake}/_fake/interactions -d '{"user":"${DEV.visitor}","command":{"name":"consent","subcommand":"agree"}}'
  # everything the relay has asked the fake Discord to do
  curl -s ${at.fake}/_fake/requests

Known limits:
  - Messages and sessions in the fake live in memory: restarting this script starts a fresh server (use --reset for a fresh database too).

Ctrl-C stops everything.
`);
console.log(
  `Started: ${children
    .filter((c) => !c.exited)
    .map((c) => `${c.name} (pid ${c.pid})`)
    .join(', ')}`,
);
await new Promise(() => {});
