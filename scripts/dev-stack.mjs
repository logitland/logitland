#!/usr/bin/env node
// Prepares a local stack: the relay and the web app, wired together.
//
//   pnpm dev:setup [--reset]      what `pnpm dev` runs first; --reset forgets the relay's local database
//
// `pnpm dev` is real: the relay runs against Discord itself, on the staging server ("logit.land but staging"), with the relay
// bot's credentials and TypeSafe's key from ~/.config/logitland/relay.env (scripts/setup-relay-bot.sh writes it), and the web
// app signs people in with Discord. Both answer on this machine's network address, so another machine on the network can
// use them (LOGITLAND_DEV_HOST overrides it); register http://<that address>:5174/auth/callback as an OAuth2 redirect.
// `pnpm dev:full` instead runs everything against the fake Discord (prepareFake), for tests and agents.
//
// Keys that seal the local database and sign sessions are generated once and kept, never taken from production. Everything
// lives under apps/backend/.wrangler, which git ignores.

import { execFile, execFileSync } from 'node:child_process';
import { createPublicKey, generateKeyPairSync } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { DEV } from '../packages/discord-fake/src/seed.ts';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const backend = join(root, 'apps/backend');

export const DEFAULT_PORTS = { fake: 8790, relay: 8787, web: 5174 };
/** `pnpm dev`'s settings, and its relay's database (apart from dev:full's and from plain `wrangler dev`'s). */
export const DEV_STATE = join(backend, '.wrangler/dev');
export const DEV_PERSIST = join(DEV_STATE, 'wrangler-state');
/**
 * The relay app's credentials, kept outside the repository: Logan staging's (scripts/setup-staging-app.sh) when they exist,
 * so local dev never acts as production's bot, else the original app's (scripts/setup-relay-bot.sh).
 */
const STAGING_RELAY_ENV = join(homedir(), '.config/logitland/relay-staging.env');
export const RELAY_ENV = existsSync(STAGING_RELAY_ENV) ? STAGING_RELAY_ENV : join(homedir(), '.config/logitland/relay.env');
/** "logit.land but staging", mirrored from the live server: where `pnpm dev`'s relay works. */
export const STAGING_GUILD_ID = '1562476123131093042';
/** The fake application's ID, which is also its bot user's. */
export const APPLICATION_ID = '400000000000000001';

/**
 * This machine's address on its network: the source address of its default route. LOGITLAND_DEV_HOST overrides it;
 * without a route (or the `ip` tool), localhost.
 */
export function devHost() {
  if (process.env.LOGITLAND_DEV_HOST) return process.env.LOGITLAND_DEV_HOST;
  try {
    return /\bsrc (\S+)/.exec(execFileSync('ip', ['route', 'get', '1.1.1.1'], { encoding: 'utf8' }))?.[1] ?? 'localhost';
  } catch {
    return 'localhost';
  }
}

/** Where `pnpm dev`'s relay and web app answer. */
export const devUrls = (host = devHost()) => ({ relay: `http://${host}:${DEFAULT_PORTS.relay}`, web: `http://${host}:${DEFAULT_PORTS.web}` });

/**
 * Where a fake stack's processes answer. Browsers keep cookies by host, not port, so a stack beside `pnpm dev`'s serves its
 * web app on another `webHost` (dev:full uses 127.0.0.1) and the two keep their own sign-ins.
 */
export const urls = (ports, webHost = 'localhost') => ({
  fake: `http://127.0.0.1:${ports.fake}`,
  relay: `http://localhost:${ports.relay}`,
  web: `http://${webHost}:${ports.web}`,
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
const token = (bytes) => random(bytes).replace(/[^A-Za-z0-9]/g, '');

/** Local keys, generated once per `state` and kept, so the database and sessions survive restarts. */
function keptSecrets(state, make) {
  const kept = join(state, 'generated-secrets.json');
  const generated = existsSync(kept) ? JSON.parse(readFileSync(kept, 'utf8')) : {};
  const secrets = Object.fromEntries(Object.entries(make).map(([name, fn]) => [name, (generated[name] ??= fn())]));
  writePrivate(kept, JSON.stringify(generated, null, 2));
  return secrets;
}

/** Makes `state`, optionally forgets the database, and returns a function running `wrangler d1 … --local` against it. */
function localDatabase({ state, reset, registry, persist }) {
  mkdirSync(state, { recursive: true });
  if (!existsSync(join(backend, 'node_modules/wrangler/bin/wrangler.js'))) throw new Error('Run `pnpm install` first: wrangler is missing.');
  if (reset) {
    rmSync(persist ?? join(backend, '.wrangler/state'), { recursive: true, force: true });
    console.log('Forgot the relay’s local database.');
  }
  const local = ['--local', ...(persist ? ['--persist-to', persist] : [])];
  return (...argv) => promisify(execFile)(...wrangler(['d1', ...argv, ...local], registry ? { WRANGLER_REGISTRY_PATH: registry } : {}));
}

/**
 * `pnpm dev`: writes `backend.env` and `web.env` for the real relay app on the staging server, and applies the migrations.
 * The server is set up the way it would be live: an admin maps `@agents` and picks the home page's channels on the dashboard.
 */
export async function prepareDev({ reset = false } = {}) {
  if (!existsSync(RELAY_ENV)) throw new Error(`${RELAY_ENV} is missing: run scripts/setup-staging-app.sh to set up Logan staging.`);
  const real = parseEnv(RELAY_ENV);
  const missing = ['DISCORD_BOT_TOKEN', 'DISCORD_APPLICATION_ID', 'DISCORD_PUBLIC_KEY', 'DISCORD_CLIENT_ID', 'DISCORD_CLIENT_SECRET'].filter((k) => !real[k]);
  if (missing.length) throw new Error(`${RELAY_ENV} lacks ${missing.join(', ')}: run scripts/setup-staging-app.sh.`);
  const at = devUrls();
  const d1 = localDatabase({ state: DEV_STATE, reset, persist: DEV_PERSIST });
  const local = keptSecrets(DEV_STATE, {
    RELAY_SECRET_KEY: () => random(32),
    INTERNAL_TOKEN: () => `dev-${token(24)}`,
    IP_HASH_KEY: () => token(32),
    SESSION_SECRET: () => random(32),
  });
  writePrivate(
    join(DEV_STATE, 'backend.env'),
    envText({
      ...parseEnv(join(backend, '.dev.vars')),
      RELAY_SECRET_KEY: local.RELAY_SECRET_KEY,
      INTERNAL_TOKEN: local.INTERNAL_TOKEN,
      IP_HASH_KEY: local.IP_HASH_KEY,
      // Development mode only relaxes the relay's own startup checks; with TYPESAFE_API_KEY, messages are checked by Jev.
      RELAY_MODE: 'development',
      DISCORD_BOT_TOKEN: real.DISCORD_BOT_TOKEN,
      DISCORD_APPLICATION_ID: real.DISCORD_APPLICATION_ID,
      DISCORD_PUBLIC_KEY: real.DISCORD_PUBLIC_KEY,
      DISCORD_GUILD_ID: STAGING_GUILD_ID,
      ...(real.TYPESAFE_API_KEY && { TYPESAFE_API_KEY: real.TYPESAFE_API_KEY }),
    }),
  );
  writePrivate(
    join(DEV_STATE, 'web.env'),
    envText({
      INTERNAL_TOKEN: local.INTERNAL_TOKEN,
      SESSION_SECRET: local.SESSION_SECRET,
      DISCORD_URL: 'https://discord.com',
      DISCORD_CLIENT_ID: real.DISCORD_CLIENT_ID,
      DISCORD_CLIENT_SECRET: real.DISCORD_CLIENT_SECRET,
    }),
  );
  console.log('Applying the relay’s migrations…');
  await d1('migrations', 'apply', 'logitland');
  return { at, jev: Boolean(real.TYPESAFE_API_KEY) };
}

/**
 * `pnpm dev:full`: writes `backend.env`, `web.env` and `fake.json` into `state` for the fake Discord, applies the migrations
 * and points the relay at the fake's server. It runs beside `pnpm dev`'s stack with its own `registry` (wrangler's dev
 * registry, so its web app finds its own relay), `persist` (the relay's database and Durable Objects) and `webHost` (see
 * `urls`). Values in apps/backend/.dev.vars win over generated ones.
 */
export async function prepareFake({ state, ports = DEFAULT_PORTS, webHost, reset = false, registry, persist }) {
  const at = urls(ports, webHost);
  const d1 = localDatabase({ state, reset, registry, persist });
  const devVars = parseEnv(join(backend, '.dev.vars'));
  const secrets = keptSecrets(state, {
    RELAY_SECRET_KEY: () => random(32),
    INTERNAL_TOKEN: () => `dev-${token(18)}`,
    SESSION_SECRET: () => random(32),
    BOT_TOKEN: () => `fake.${token(24)}`,
    INTERACTION_KEY_PEM: () => generateKeyPairSync('ed25519').privateKey.export({ type: 'pkcs8', format: 'pem' }),
  });
  // Discord's public key is the raw 32 bytes, in hex.
  const publicKey = Buffer.from(createPublicKey(secrets.INTERACTION_KEY_PEM).export({ format: 'jwk' }).x, 'base64url').toString('hex');

  writePrivate(join(state, 'fake.json'), JSON.stringify({ bot_token: secrets.BOT_TOKEN, interaction_key_pem: secrets.INTERACTION_KEY_PEM }));
  // Admins are the fake application's Developer team: its seeded admin. Add yourself with PATCH /_fake/application {"team": [...]}.
  writePrivate(
    join(state, 'backend.env'),
    envText({
      ...devVars,
      RELAY_SECRET_KEY: devVars.RELAY_SECRET_KEY || secrets.RELAY_SECRET_KEY,
      INTERNAL_TOKEN: devVars.INTERNAL_TOKEN || secrets.INTERNAL_TOKEN,
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
      INTERNAL_TOKEN: devVars.INTERNAL_TOKEN || secrets.INTERNAL_TOKEN,
      SESSION_SECRET: secrets.SESSION_SECRET,
      DISCORD_URL: at.fake,
      DISCORD_CLIENT_ID: APPLICATION_ID,
      DISCORD_CLIENT_SECRET: 'fake',
    }),
  );

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
  return { at, files: { backend: join(state, 'backend.env'), web: join(state, 'web.env'), fake: join(state, 'fake.json') } };
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { at, jev } = await prepareDev({ reset: process.argv.includes('--reset') });
  console.log(`Ready, on Discord's staging server${jev ? ', with Jev checking messages' : ' (no TYPESAFE_API_KEY: messages wait for a classifier)'}. Once everything is up:
  ${at.web}/sign-in        sign in with Discord (the relay app's team are full admins)
  ${at.relay}/skill.md      how an agent joins`);
}
