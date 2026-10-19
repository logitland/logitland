import type { AiBinding, Db, DeliveryQueue, RelayConfig } from './context';

/** Plain values a Worker provides. Secrets come from `wrangler secret put` (or .dev.vars locally). */
export interface RelayBindings {
  DB: Db;
  DELIVERIES?: DeliveryQueue;
  AI?: AiBinding;
  RELAY_SECRET_KEY: string;
  /** Defaults to k1. Change it together with RELAY_SECRET_KEY when rotating. */
  RELAY_SECRET_KEY_ID?: string;
  /** Older keys that may still open stored values: `id:base64,id:base64`. */
  RELAY_SECRET_KEYS_OLD?: string;
  INTERNAL_TOKEN: string;
  IP_HASH_KEY?: string;
  PUBLIC_URL: string;
  DASHBOARD_URL: string;
  DISCORD_BOT_TOKEN?: string;
  DISCORD_APPLICATION_ID?: string;
  DISCORD_PUBLIC_KEY?: string;
  DISCORD_GUILD_ID?: string;
  DISCORD_CONSENT_ROLE_ID?: string;
  JEV_LAYA_URL?: string;
  JEV_LAYA_TOKEN?: string;
  ADMIN_DISCORD_IDS?: string;
  BLOCKED_HOSTS?: string;
  MODERATION_OUTAGE?: string;
  /** "development" switches to the stub moderator and relaxed checks. Only accepted on a local PUBLIC_URL. */
  RELAY_MODE?: string;
  /** Development only: point Discord REST (and so the Gateway URL) at a local fake, e.g. http://127.0.0.1:8790/api/v10. */
  DISCORD_API_BASE?: string;
}

export class ConfigError extends Error {
  constructor(readonly problems: string[]) {
    super(`Relay configuration problems: ${problems.join('; ')}`);
    this.name = 'ConfigError';
  }
}

const LOCAL_HOST = /^(localhost|127\.0\.0\.1|\[::1\])$|\.(localhost|test)$/;
const PLACEHOLDER_HOST = /(^|\.)(invalid|example)$|replace/i;
/** Values from the example env files and docs. A random token is never refused for what it happens to contain. */
const PLACEHOLDER_TOKENS = ['dev-internal-token', 'test-internal-token', 'changeme', 'change-me', 'replace-me'];

const list = (v?: string) =>
  (v ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

function host(raw: string): string | null {
  try {
    return new URL(raw).hostname.toLowerCase();
  } catch {
    return null;
  }
}

const KEY_ID = /^[A-Za-z0-9_-]{1,16}$/;

function keyBytes(key: string): number | null {
  try {
    return atob(key).length;
  } catch {
    return null;
  }
}

/** The encryption keys and their IDs. Mistakes here would otherwise surface as a crash, or as a rotation that quietly does nothing. */
function secretKeyProblems(env: RelayBindings): string[] {
  const problems: string[] = [];
  if (!env.RELAY_SECRET_KEY) problems.push('RELAY_SECRET_KEY is missing');
  else if (keyBytes(env.RELAY_SECRET_KEY) !== 32) problems.push('RELAY_SECRET_KEY must be 32 random bytes, base64-encoded (openssl rand -base64 32)');
  const currentId = env.RELAY_SECRET_KEY_ID ?? 'k1';
  if (!KEY_ID.test(currentId)) problems.push('RELAY_SECRET_KEY_ID must be 1 to 16 letters, digits, - or _');
  const seen = new Set([currentId]);
  for (const pair of list(env.RELAY_SECRET_KEYS_OLD)) {
    const i = pair.indexOf(':');
    const id = pair.slice(0, i);
    if (i < 1 || !KEY_ID.test(id) || keyBytes(pair.slice(i + 1)) !== 32) {
      problems.push('RELAY_SECRET_KEYS_OLD must be id:base64 pairs separated by commas, each key 32 bytes');
      continue;
    }
    if (seen.has(id))
      problems.push(`RELAY_SECRET_KEYS_OLD lists the key ID ${id} twice, or the same ID as RELAY_SECRET_KEY_ID; the new key needs a new RELAY_SECRET_KEY_ID`);
    seen.add(id);
  }
  return problems;
}

/** Every problem with the bindings, by name only (never values). Empty means the relay may start. */
export function checkConfig(env: RelayBindings): string[] {
  const problems: string[] = [];
  const publicHost = host(env.PUBLIC_URL ?? '');
  const dashboardHost = host(env.DASHBOARD_URL ?? '');
  if (!publicHost) problems.push('PUBLIC_URL is not a URL');
  if (!dashboardHost) problems.push('DASHBOARD_URL is not a URL');
  problems.push(...secretKeyProblems(env));

  const dev = env.RELAY_MODE === 'development';
  if (env.DISCORD_API_BASE && !dev) problems.push('DISCORD_API_BASE is only allowed in development');
  if (dev) {
    if (publicHost && !LOCAL_HOST.test(publicHost)) problems.push('RELAY_MODE=development is only allowed on a local PUBLIC_URL');
    return problems;
  }
  if (env.RELAY_MODE) problems.push('RELAY_MODE must be unset outside development');

  for (const [name, value, h] of [
    ['PUBLIC_URL', env.PUBLIC_URL, publicHost],
    ['DASHBOARD_URL', env.DASHBOARD_URL, dashboardHost],
  ] as const) {
    if (!h) continue;
    if (!value.startsWith('https://')) problems.push(`${name} must use https`);
    if (LOCAL_HOST.test(h)) problems.push(`${name} points at a local host`);
    if (PLACEHOLDER_HOST.test(h)) problems.push(`${name} is still a placeholder`);
  }
  if (!env.INTERNAL_TOKEN || env.INTERNAL_TOKEN.length < 32) problems.push('INTERNAL_TOKEN must be at least 32 random characters');
  else if (PLACEHOLDER_TOKENS.some((p) => env.INTERNAL_TOKEN.toLowerCase().startsWith(p)))
    problems.push('INTERNAL_TOKEN is still an example value; generate a new one');
  if (!env.IP_HASH_KEY || env.IP_HASH_KEY.length < 32) problems.push('IP_HASH_KEY must be at least 32 random characters');
  if (!env.DISCORD_BOT_TOKEN) problems.push('DISCORD_BOT_TOKEN is missing');
  for (const name of ['DISCORD_APPLICATION_ID', 'DISCORD_PUBLIC_KEY', 'DISCORD_GUILD_ID', 'DISCORD_CONSENT_ROLE_ID'] as const)
    if (!env[name]) problems.push(`${name} is missing`);
  if (!(env.JEV_LAYA_URL && env.JEV_LAYA_TOKEN) && !env.AI) problems.push('No classifier: set JEV_LAYA_URL and JEV_LAYA_TOKEN, or bind AI');
  // Every message the classifier checks, with its context, goes there along with the bearer token.
  if (env.JEV_LAYA_URL) {
    const h = host(env.JEV_LAYA_URL);
    if (!h || !env.JEV_LAYA_URL.startsWith('https://') || LOCAL_HOST.test(h) || PLACEHOLDER_HOST.test(h))
      problems.push('JEV_LAYA_URL must be an https URL on a public host');
  }
  if (!list(env.ADMIN_DISCORD_IDS).length) problems.push('ADMIN_DISCORD_IDS is empty');
  // Without the queue the cron scan would attempt every delivery itself, inside its own query budget.
  if (!env.DELIVERIES) problems.push('The DELIVERIES queue binding is missing');
  if (env.MODERATION_OUTAGE && !['hold', 'refuse'].includes(env.MODERATION_OUTAGE)) problems.push('MODERATION_OUTAGE must be hold or refuse');
  return problems;
}

export function buildConfig(env: RelayBindings): RelayConfig {
  const dev = env.RELAY_MODE === 'development';
  const publicUrl = env.PUBLIC_URL.replace(/\/$/, '');
  const dashboardUrl = env.DASHBOARD_URL.replace(/\/$/, '');
  return {
    publicUrl,
    dashboardUrl,
    internalToken: env.INTERNAL_TOKEN,
    adminDiscordIds: list(env.ADMIN_DISCORD_IDS),
    blockedHosts: [...list(env.BLOCKED_HOSTS).map((h) => h.toLowerCase()), host(publicUrl)!, host(dashboardUrl)!, 'workers.dev'],
    moderationOutage: env.MODERATION_OUTAGE === 'refuse' ? 'refuse' : 'hold',
    hashKey: env.IP_HASH_KEY ?? (dev ? 'development-only-hash-key-not-secret' : ''),
    discord: {
      applicationId: env.DISCORD_APPLICATION_ID ?? null,
      publicKey: env.DISCORD_PUBLIC_KEY ?? null,
      guildId: env.DISCORD_GUILD_ID ?? null,
      consentRoleId: env.DISCORD_CONSENT_ROLE_ID ?? null,
    },
    development: dev,
  };
}

export function parseOldKeys(v?: string): { id: string; key: string }[] {
  return list(v).map((pair) => {
    const i = pair.indexOf(':');
    return { id: pair.slice(0, i), key: pair.slice(i + 1) };
  });
}
