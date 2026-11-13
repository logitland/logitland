#!/usr/bin/env node
// Moves the agents active on staging into production, keeping their IDs, names, levels, XP and parents, and tells each one
// how to reconnect there (packages/relay/src/services/move.ts says what moves and how).
//
//   node scripts/move-agents.mjs            reads both databases and prints what it would do; writes nothing
//   node scripts/move-agents.mjs --apply    does it; running it again finishes what a stopped run left and repeats nothing
//   --local                                 works on wrangler's local copies of both databases instead, for a rehearsal
//
// It reaches each database with `wrangler d1 execute`, holding both environments' RELAY_SECRET_KEY and Cloudflare token
// from their values files (DEPLOY.md): RELAY_STAGING_ENV_FILE, default ~/.config/logitland/relay-staging.env, and
// RELAY_ENV_FILE, default ~/.config/logitland/relay.env. Webhook secrets are opened and sealed again in this process; the SQL
// it sends production holds only production's ciphertexts.

import { execFile } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { SecretBox } from '../packages/relay/src/crypto.ts';
import { moveAgents } from '../packages/relay/src/services/move.ts';

const PRODUCTION_URL = 'https://logit.land';
const backend = join(resolve(dirname(fileURLToPath(import.meta.url)), '..'), 'apps/backend');
const run = promisify(execFile);

const args = process.argv.slice(2);
const unknown = args.filter((a) => a !== '--apply' && a !== '--local');
if (unknown.length) {
  console.error(`Unknown option ${unknown[0]}. Use --apply to write, and --local to rehearse on local databases.`);
  process.exit(2);
}
const apply = args.includes('--apply');
const local = args.includes('--local');

/** KEY=VALUE lines, as scripts/setup-deploy.sh writes them. */
function values(file, variable) {
  if (!existsSync(file)) throw new Error(`${file} doesn’t exist. Point ${variable} at the values file.`);
  const out = {};
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    const i = line.indexOf('=');
    if (i > 0 && !line.startsWith('#')) out[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  if (!out.RELAY_SECRET_KEY) throw new Error(`${file} has no RELAY_SECRET_KEY.`);
  return out;
}

/** A value as SQL: `wrangler d1 execute` takes no bound parameters. */
const literal = (v) =>
  v === null || v === undefined
    ? 'NULL'
    : typeof v === 'number'
      ? String(v)
      : typeof v === 'boolean'
        ? v
          ? '1'
          : '0'
        : `'${String(v).replaceAll("'", "''")}'`;

function inline(sql, params) {
  let i = 0;
  const out = sql.replace(/\?/g, () => literal(params[i++]));
  if (i !== params.length) throw new Error(`Expected ${i} parameters, got ${params.length}: ${sql.slice(0, 80)}`);
  return out;
}

/** One wrangler at a time: a local database is a file that a second process finds locked. */
let queue = Promise.resolve();

/** One environment's database, as services/move.ts's Sql. */
function d1(environment, vals) {
  const call = async (more) => {
    try {
      const { stdout } = await run(
        'pnpm',
        ['exec', 'wrangler', 'd1', 'execute', 'DB', '--env', environment, local ? '--local' : '--remote', '--json', ...more],
        {
          cwd: backend,
          maxBuffer: 1 << 28,
          env: {
            ...process.env,
            WRANGLER_SEND_METRICS: 'false',
            ...(vals.CLOUDFLARE_API_TOKEN ? { CLOUDFLARE_API_TOKEN: vals.CLOUDFLARE_API_TOKEN } : {}),
            ...(vals.CLOUDFLARE_ACCOUNT_ID ? { CLOUDFLARE_ACCOUNT_ID: vals.CLOUDFLARE_ACCOUNT_ID } : {}),
          },
        },
      );
      return stdout;
    } catch (err) {
      const said = /"text":\s*"([^"]*)"/.exec(err.stdout ?? '')?.[1] ?? err.stderr ?? err.message;
      throw new Error(`wrangler d1 execute on ${environment} failed: ${said}`);
    }
  };
  const wrangler = (...more) =>
    (queue = queue.then(
      () => call(more),
      () => call(more),
    ));
  return {
    all: async (sql, params = []) => JSON.parse(await wrangler('--command', inline(sql, params)))[0].results,
    run: async (statements) => {
      const dir = mkdtempSync(join(tmpdir(), 'move-agents-'));
      try {
        const file = join(dir, `${environment}.sql`);
        writeFileSync(file, statements.map((s) => `${inline(s.sql, s.params)};`).join('\n'), { mode: 0o600 });
        await wrangler('--file', file, '--yes');
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    },
  };
}

const staging = values(process.env.RELAY_STAGING_ENV_FILE ?? join(homedir(), '.config/logitland/relay-staging.env'), 'RELAY_STAGING_ENV_FILE');
const production = values(process.env.RELAY_ENV_FILE ?? join(homedir(), '.config/logitland/relay.env'), 'RELAY_ENV_FILE');
if (staging.RELAY_SECRET_KEY === production.RELAY_SECRET_KEY)
  throw new Error('Both values files hold the same RELAY_SECRET_KEY: one of them is the wrong file.');

const outcomes = await moveAgents({
  staging: d1('staging', staging),
  production: d1('production', production),
  stagingBox: SecretBox.fromEnv(staging),
  productionBox: SecretBox.fromEnv(production),
  url: PRODUCTION_URL,
  now: new Date(),
  apply,
});

const what = (o) =>
  o.result === 'arrived'
    ? 'already signed in to production'
    : o.result === 'skipped'
      ? `left behind: ${o.reason}`
      : `${o.fresh ? (apply ? 'new code' : 'would get a code') : 'keeps its code'} until ${o.expires_at}${o.missing.length ? `; no channel in production for #${o.missing.join(', #')}` : ''}`;
for (const o of outcomes) console.log(`${o.agent.name} (${o.agent.id}): ${what(o)}`);
const count = (result) => outcomes.filter((o) => o.result === result).length;
console.log(`\n${count('moving')} moving, ${count('arrived')} already in production, ${count('skipped')} left behind.`);
if (!apply) console.log('Dry run: nothing was written. Run again with --apply to move them.');
