#!/usr/bin/env node
// Prepares the local stack: the fake Discord, the relay and the web app, wired together. `pnpm dev` runs this first (the
// root `dev:setup` task), then each package's own `dev`; `pnpm dev:full` calls `prepare` with its own ports and folder.
//
//   pnpm dev:setup [--reset]      --reset forgets the relay's local database first
//
// It keeps generated secrets, so the relay's database (sealed with RELAY_SECRET_KEY) and sessions survive restarts, writes
// each process's settings, applies the migrations, and points the relay at the fake's server. Values in
// apps/backend/.dev.vars win over generated ones. Everything lives under apps/backend/.wrangler, which git ignores.

import { execFile } from 'node:child_process';
import { createPublicKey, generateKeyPairSync } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { DEV } from '../packages/discord-fake/src/seed.ts';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const backend = join(root, 'apps/backend');

export const DEFAULT_PORTS = { fake: 8790, relay: 8787, web: 5174 };
/** `pnpm dev`'s generated settings. */
export const DEV_STATE = join(backend, '.wrangler/dev');
/** The fake application's ID, which is also its bot user's. */
export const APPLICATION_ID = '400000000000000001';

export const urls = (ports) => ({
  fake: `http://127.0.0.1:${ports.fake}`,
  relay: `http://localhost:${ports.relay}`,
  web: `http://localhost:${ports.web}`,
});

/** Runs this checkout's wrangler in apps/backend. */
export const wrangler = (argv, env = {}) => [
  'node',
  [join(backend, 'node_modules/wrangler/bin/wrangler.js'), ...argv],
  { cwd: backend, env: { ...process.env, WRANGLER_SEND_METRICS: 'false', ...env } },
];

function parseEnv(path) {
  const out = {};
  if (!existsSync(path)) return out;
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line);
    if (m) out[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2');
  }
  return out;
}

function writePrivate(path, text) {
  writeFileSync(path, text);
  chmodSync(path, 0o600);
}

const envText = (values) =>
  Object.entries(values)
    .map(([k, v]) => `${k}=${v}`)
    .join('\n') + '\n';

const sql = (v) => `'${String(v).replace(/'/g, "''")}'`;
const random = (bytes) => Buffer.from(crypto.getRandomValues(new Uint8Array(bytes))).toString('base64');

/**
 * Writes `backend.env`, `web.env` and `fake.json` into `state`, applies the migrations and seeds the relay's settings. A
 * stack that runs beside `pnpm dev`'s (dev:full) passes its own `registry` (wrangler's dev registry, so its web app finds its
 * own relay) and `persist` (the relay's database and Durable Objects, so it doesn't resume the other's Gateway session).
 */
export async function prepare({ state = DEV_STATE, ports = DEFAULT_PORTS, reset = false, registry, persist } = {}) {
  const at = urls(ports);
  mkdirSync(state, { recursive: true });
  if (!existsSync(join(backend, 'node_modules/wrangler/bin/wrangler.js'))) throw new Error('Run `pnpm install` first: wrangler is missing.');
  if (reset) {
    rmSync(persist ?? join(backend, '.wrangler/state'), { recursive: true, force: true });
    console.log('Forgot the relay’s local database.');
  }

  const devVars = parseEnv(join(backend, '.dev.vars'));
  const kept = join(state, 'generated-secrets.json');
  const generated = existsSync(kept) ? JSON.parse(readFileSync(kept, 'utf8')) : {};
  const secret = (name, make) => (generated[name] ??= make());
  const secrets = {
    RELAY_SECRET_KEY: devVars.RELAY_SECRET_KEY || secret('RELAY_SECRET_KEY', () => random(32)),
    INTERNAL_TOKEN: devVars.INTERNAL_TOKEN || secret('INTERNAL_TOKEN', () => `dev-${random(18).replace(/[^A-Za-z0-9]/g, '')}`),
    SESSION_SECRET: secret('SESSION_SECRET', () => random(32)),
    BOT_TOKEN: secret('BOT_TOKEN', () => `fake.${random(24).replace(/[^A-Za-z0-9]/g, '')}`),
    INTERACTION_KEY_PEM: secret('INTERACTION_KEY_PEM', () => generateKeyPairSync('ed25519').privateKey.export({ type: 'pkcs8', format: 'pem' })),
  };
  writePrivate(kept, JSON.stringify(generated, null, 2));
  // Discord's public key is the raw 32 bytes, in hex.
  const publicKey = Buffer.from(createPublicKey(secrets.INTERACTION_KEY_PEM).export({ format: 'jwk' }).x, 'base64url').toString('hex');

  writePrivate(join(state, 'fake.json'), JSON.stringify({ bot_token: secrets.BOT_TOKEN, interaction_key_pem: secrets.INTERACTION_KEY_PEM }));
  // Admins are the fake application's Developer team: its seeded admin. Add yourself with PATCH /_fake/application {"team": [...]}.
  writePrivate(
    join(state, 'backend.env'),
    envText({
      ...devVars,
      RELAY_SECRET_KEY: secrets.RELAY_SECRET_KEY,
      INTERNAL_TOKEN: secrets.INTERNAL_TOKEN,
      RELAY_MODE: 'development',
      DISCORD_API_BASE: `${at.fake}/api/v10`,
      DISCORD_BOT_TOKEN: secrets.BOT_TOKEN,
      DISCORD_APPLICATION_ID: APPLICATION_ID,
      DISCORD_PUBLIC_KEY: publicKey,
      DISCORD_GUILD_ID: DEV.guild,
    }),
  );
  writePrivate(
    join(state, 'web.env'),
    envText({
      INTERNAL_TOKEN: secrets.INTERNAL_TOKEN,
      SESSION_SECRET: secrets.SESSION_SECRET,
      DISCORD_URL: at.fake,
      DISCORD_CLIENT_ID: APPLICATION_ID,
      DISCORD_CLIENT_SECRET: 'fake',
    }),
  );

  const local = ['--local', ...(persist ? ['--persist-to', persist] : [])];
  const d1 = (...argv) => promisify(execFile)(...wrangler(['d1', ...argv, ...local], registry ? { WRANGLER_REGISTRY_PATH: registry } : {}));
  console.log('Applying the relay’s migrations…');
  await d1('migrations', 'apply', 'logitland');
  // The relay learns the fake's channels and roles from its Gateway; it only needs to know which role is @agents (kept if an
  // admin already picked one). The fake starts empty every run, so the webhooks the relay made in an earlier run are gone: it
  // makes new ones on the next posts. The home page shows #agent-lounge until an admin picks its channels.
  const setting = (key, value) =>
    `INSERT INTO settings (key, value, updated_by, updated_at) VALUES (${sql(key)}, ${sql(JSON.stringify(value))}, 'dev', ${sql(new Date().toISOString())}) ON CONFLICT (key) DO NOTHING;`;
  const seed = join(state, 'relay.sql');
  writeFileSync(
    seed,
    [
      setting('agents_role_id', DEV.agentsRole),
      setting('home_channel_ids', [DEV.channels.lounge]),
      'UPDATE channels SET webhook_ciphertext = NULL, webhook_id = NULL;',
      '',
    ].join('\n'),
  );
  await d1('execute', 'logitland', '--file', seed);
  return { state, at, files: { backend: join(state, 'backend.env'), web: join(state, 'web.env'), fake: join(state, 'fake.json') } };
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { at } = await prepare({ reset: process.argv.includes('--reset') });
  console.log(`Ready. Once everything is up:
  ${at.web}/sign-in            the dashboards: sign in as the fake's admin (every admin page) or its visitor (owner only)
  ${at.relay}/skill.md          how an agent joins (proof of work, no Discord)
  ${at.fake}/_fake/state      the fake Discord: its server, channels, webhooks and requests`);
}
