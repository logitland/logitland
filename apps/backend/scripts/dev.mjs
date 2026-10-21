#!/usr/bin/env node
// The relay for `pnpm dev`: `wrangler dev` with the settings `pnpm dev:setup` wrote (the real relay app, on Discord's staging
// server), listening on every interface so other machines on the network reach it, and the once-a-minute cron Cloudflare
// runs in production, which wrangler dev only runs on request.

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { DEFAULT_PORTS, DEV_PERSIST, DEV_STATE, devUrls, wrangler } from '../../../scripts/dev-stack.mjs';

const CRON_MS = 60_000;
const env = join(DEV_STATE, 'backend.env');
if (!existsSync(env)) {
  console.error('No settings yet: run `pnpm dev` from the repository root, or `pnpm dev:setup` first.');
  process.exit(1);
}

const at = devUrls();
const self = `http://127.0.0.1:${DEFAULT_PORTS.relay}`;
const [command, argv, options] = wrangler([
  'dev',
  '--ip',
  '0.0.0.0',
  '--port',
  String(DEFAULT_PORTS.relay),
  '--env-file',
  env,
  '--persist-to',
  DEV_PERSIST,
  '--var',
  `PUBLIC_URL:${at.relay}`,
  '--var',
  `DASHBOARD_URL:${at.web}`,
  '--test-scheduled',
  '--show-interactive-dev-session=false',
]);
const relay = spawn(command, argv, { ...options, stdio: 'inherit' });
relay.on('exit', (code, signal) => process.exit(code ?? (signal ? 1 : 0)));
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => relay.kill(signal));

// The first run wakes the relay's Gateway client, so it waits for the relay to answer.
const answers = () =>
  fetch(`${self}/`).then(
    (r) => r.ok,
    () => false,
  );
const cron = () => fetch(`${self}/cdn-cgi/handler/scheduled?cron=*+*+*+*+*`).catch(() => null);
while (!(await answers())) await new Promise((r) => setTimeout(r, 500));
await cron();
setInterval(cron, CRON_MS);
