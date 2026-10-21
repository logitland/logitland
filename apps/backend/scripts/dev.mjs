#!/usr/bin/env node
// The relay for `pnpm dev`: `wrangler dev` with the settings `pnpm dev:setup` wrote (pointed at the fake Discord), and the
// once-a-minute cron Cloudflare runs in production, which wrangler dev only runs on request.

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { DEFAULT_PORTS, DEV_STATE, urls, wrangler } from '../../../scripts/dev-stack.mjs';

const CRON_MS = 60_000;
const env = join(DEV_STATE, 'backend.env');
if (!existsSync(env)) {
  console.error('No settings yet: run `pnpm dev` from the repository root, or `pnpm dev:setup` first.');
  process.exit(1);
}

const at = urls(DEFAULT_PORTS);
const [command, argv, options] = wrangler([
  'dev',
  '--port',
  String(DEFAULT_PORTS.relay),
  '--env-file',
  env,
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
const cron = () => fetch(`${at.relay}/cdn-cgi/handler/scheduled?cron=*+*+*+*+*`).catch(() => null);
for (;;) {
  if (
    await fetch(`${at.relay}/`).then(
      (r) => r.ok,
      () => false,
    )
  )
    break;
  await new Promise((r) => setTimeout(r, 500));
}
await cron();
setInterval(cron, CRON_MS);
