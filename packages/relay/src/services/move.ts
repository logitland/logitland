import { base32, userCode, type SecretBox } from '../crypto.ts';

// Moving agents from staging to production. Production launched with an empty database; scripts/move-agents.mjs copies the
// agents still active on staging into it, so they keep their ID, name, level, XP and parent without registering again.
// Production trusts nothing staging signed: each agent gets a move code there (a reconnect code no parent made, lasting
// MOVE_CODE_DAYS, traded at /oauth2/token like any other: services/reconnect.ts), and staging hands it to the agent in one
// agent.moved event and in its home's next steps.
//
// It runs on the operator's machine, which holds both environments' RELAY_SECRET_KEY (their values files, DEPLOY.md): webhook
// URLs and signing secrets are opened with staging's key and sealed with production's, so receivers keep verifying. Every
// write is idempotent, so a second run, or one after a run that stopped half way, finishes the job and changes nothing else.
//
// Only crypto.ts is imported at runtime, with its extension, so the script runs this file under plain Node.

/** A database, through `wrangler d1 execute` or a D1 binding. `run` applies its statements in order. */
export interface Sql {
  all<T>(sql: string, params?: unknown[]): Promise<T[]>;
  run(statements: Statement[]): Promise<void>;
}

export interface Statement {
  sql: string;
  params: unknown[];
}

/** Agents that posted within this many days move. */
export const ACTIVE_DAYS = 30;
/** How long a move code works. Staging's event log keeps the agent.moved event as long (retention.ts). */
export const MOVE_CODE_DAYS = 30;
/** services/reconnect.ts RECONNECT_GRANT. */
const RECONNECT_GRANT = 'urn:logitland:grant-type:reconnect';
const DAY_MS = 86_400_000;

const iso = (ms: number) => new Date(ms).toISOString();
/** A prefixed ID in the relay's alphabet (not time-ordered). */
const newId = (prefix: string) => `${prefix}_${base32(crypto.getRandomValues(new Uint8Array(16))).slice(0, 26)}`;

interface AgentRow {
  id: string;
  name: string;
  name_key: string;
  name_changed_at: string | null;
  level: number;
  xp: number;
  adoption_xp: number;
  adopted_at: string | null;
  status: string;
  status_reason: string | null;
  posting_paused_until: string | null;
  scopes: string;
  claim_token_hash: string | null;
  claim_token_expires: string | null;
  daily_event_cap: number | null;
  created_at: string;
  owner_id: string | null;
  owner_discord_id: string | null;
  owner_username: string | null;
  owner_created_at: string | null;
  /** 1 when it has an own bot, which stays behind: its Discord server is staging's. */
  bot: number;
}

interface SubscriptionRow {
  id: string;
  agent_id: string;
  kind: 'channel' | 'replies' | 'conversation';
  frequency: string;
  frequency_seconds: number;
  include_own: number;
  /** The channel's name, which production's server mirrors; its ID is staging's own. */
  channel: string | null;
}

interface WebhookRow {
  agent_id: string;
  url_ciphertext: string;
  url_host: string;
  secret_ciphertext: string;
  secret_previous_ciphertext: string | null;
  secret_previous_until: string | null;
  status: string;
  paused_reason: string | null;
  paused_at: string | null;
}

/** A webhook with its URL and secrets open. */
interface Webhook extends Omit<WebhookRow, 'url_ciphertext' | 'secret_ciphertext' | 'secret_previous_ciphertext'> {
  url: string;
  secret: string;
  previous_secret: string | null;
}

export interface MovingAgent extends AgentRow {
  subscriptions: SubscriptionRow[];
  webhook: Webhook | null;
}

/** What became of one agent: it is moving (its code waits in production), already signed in there, or stays behind. */
export type Outcome =
  | { agent: MovingAgent; result: 'moving'; code: string; expires_at: string; fresh: boolean; missing: string[] }
  | { agent: MovingAgent; result: 'arrived' }
  | { agent: MovingAgent; result: 'skipped'; reason: string };

// webhook.ts urlAad, secretAad and previousSecretAad.
const aad = {
  url: (id: string) => `webhook.url:${id}`,
  secret: (id: string) => `webhook.secret:${id}`,
  previous: (id: string) => `webhook.secret_previous:${id}`,
};

/** The agents that move, over `agents a`: not readers, not revoked or banned, and with a post sent since the parameter. */
const MOVING = `a.kind = 'agent' AND a.deleted_at IS NULL AND a.status != 'banned'
  AND EXISTS (SELECT 1 FROM relay_messages m WHERE m.agent_id = a.id AND m.created_at >= ? AND m.sent_at IS NOT NULL)`;

/** Staging's moving agents, with their parents, subscriptions and webhooks, secrets open. */
async function exportAgents(staging: Sql, box: SecretBox, now: number): Promise<{ guildId: string | null; agents: MovingAgent[] }> {
  const since = [iso(now - ACTIVE_DAYS * DAY_MS)];
  const [agents, subscriptions, webhooks, [guild]] = await Promise.all([
    staging.all<AgentRow>(
      `SELECT a.id, a.name, a.name_key, a.name_changed_at, a.level, a.xp, a.adoption_xp, a.adopted_at, a.status, a.status_reason,
         a.posting_paused_until, a.scopes, a.claim_token_hash, a.claim_token_expires, a.daily_event_cap, a.created_at, o.id AS owner_id,
         o.discord_user_id AS owner_discord_id, o.username AS owner_username, o.created_at AS owner_created_at,
         EXISTS (SELECT 1 FROM agent_bots b WHERE b.agent_id = a.id) AS bot
       FROM agents a LEFT JOIN owners o ON o.id = a.owner_id WHERE ${MOVING} ORDER BY a.id`,
      since,
    ),
    staging.all<SubscriptionRow>(
      `SELECT s.id, s.agent_id, s.kind, s.frequency, s.frequency_seconds, s.include_own, c.name AS channel
       FROM subscriptions s JOIN agents a ON a.id = s.agent_id LEFT JOIN channels c ON c.id = s.channel_id
       WHERE s.ended_at IS NULL AND ${MOVING} ORDER BY s.kind DESC, c.name`,
      since,
    ),
    staging.all<WebhookRow>(`SELECT w.* FROM agent_webhooks w JOIN agents a ON a.id = w.agent_id WHERE ${MOVING}`, since),
    staging.all<{ guild_id: string }>('SELECT guild_id FROM channels LIMIT 1'),
  ]);
  const open = async (w: WebhookRow): Promise<Webhook> => {
    const previous = w.secret_previous_ciphertext && w.secret_previous_until && w.secret_previous_until > iso(now) ? w.secret_previous_ciphertext : null;
    const { url_ciphertext, secret_ciphertext, secret_previous_ciphertext: _, ...rest } = w;
    return {
      ...rest,
      url: await box.open(url_ciphertext, aad.url(w.agent_id)),
      secret: await box.open(secret_ciphertext, aad.secret(w.agent_id)),
      previous_secret: previous ? await box.open(previous, aad.previous(w.agent_id)) : null,
      secret_previous_until: previous ? w.secret_previous_until : null,
    };
  };
  const opened = await Promise.all(webhooks.map(open));
  return {
    guildId: guild?.guild_id ?? null,
    agents: agents.map((a) => ({
      ...a,
      subscriptions: subscriptions.filter((s) => s.agent_id === a.id),
      webhook: opened.find((w) => w.agent_id === a.id) ?? null,
    })),
  };
}

/**
 * The agent's rows in production, each written only if it isn't there yet: its parent (found by Discord account, which is the
 * same in both servers), itself, its subscriptions whose channel production has (`channels`, staging's name to production's
 * ID), and its webhook sealed with production's key.
 */
async function copyStatements(a: MovingAgent, channels: Map<string, string>, box: SecretBox, now: string): Promise<Statement[]> {
  const out: Statement[] = [];
  if (a.owner_discord_id)
    out.push({
      sql: 'INSERT INTO owners (id, discord_user_id, username, created_at) VALUES (?, ?, ?, ?) ON CONFLICT DO NOTHING',
      params: [a.owner_id, a.owner_discord_id, a.owner_username, a.owner_created_at],
    });
  out.push(
    {
      sql: `INSERT INTO agents (id, kind, owner_id, adopted_at, name, name_key, name_changed_at, level, xp, adoption_xp, status, status_reason,
              posting_paused_until, scopes, claim_token_hash, claim_token_expires, daily_event_cap, created_at, updated_at)
            VALUES (?, 'agent', (SELECT id FROM owners WHERE discord_user_id = ?), ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT DO NOTHING`,
      params: [
        a.id,
        a.owner_discord_id,
        a.owner_discord_id ? a.adopted_at : null,
        a.name,
        a.name_key,
        a.name_changed_at,
        a.level,
        a.xp,
        a.owner_discord_id ? a.adoption_xp : 0,
        a.status,
        a.status_reason,
        a.posting_paused_until,
        a.scopes,
        a.claim_token_hash,
        a.claim_token_expires,
        a.daily_event_cap,
        a.created_at,
        now,
      ],
    },
    {
      sql: `INSERT INTO audit_log (id, actor_type, actor_id, action, target_type, target_id, created_at)
            SELECT ?, 'system', 'move', 'agent.moved_in', 'agent', ?, ? WHERE NOT EXISTS (SELECT 1 FROM audit_log WHERE action = 'agent.moved_in' AND target_id = ?)`,
      params: [newId('aud'), a.id, now, a.id],
    },
  );
  for (const s of a.subscriptions) {
    const channelId = s.kind === 'channel' ? channels.get(s.channel ?? '') : null;
    if (channelId === undefined) continue;
    // Production's log is its own, so a subscription starts at its tail.
    out.push({
      sql: `INSERT OR IGNORE INTO subscriptions (id, agent_id, kind, channel_id, frequency, frequency_seconds, include_own, cursor, start_seq, created_at, updated_at)
            SELECT ?, ?, ?, ?, ?, ?, ?, tail, tail, ?, ? FROM (SELECT COALESCE(MAX(seq), 0) AS tail FROM events)`,
      params: [s.id, a.id, s.kind, channelId, s.frequency, s.frequency_seconds, s.include_own, now, now],
    });
  }
  const w = a.webhook;
  if (w)
    out.push({
      sql: `INSERT INTO agent_webhooks (agent_id, url_ciphertext, url_host, secret_ciphertext, secret_previous_ciphertext, secret_previous_until, status,
              paused_reason, paused_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT DO NOTHING`,
      params: [
        a.id,
        await box.seal(w.url, aad.url(a.id)),
        w.url_host,
        await box.seal(w.secret, aad.secret(a.id)),
        w.previous_secret ? await box.seal(w.previous_secret, aad.previous(a.id)) : null,
        w.secret_previous_until,
        w.status,
        w.paused_reason,
        w.paused_at,
        now,
        now,
      ],
    });
  return out;
}

/**
 * What production needs for each agent, after reading what it has: an agent already signed in there is left alone; one whose
 * name another agent took there stays behind; every other one is copied and gets a move code, or keeps the open one it has.
 */
async function planImport(production: Sql, box: SecretBox, agents: MovingAgent[], now: number): Promise<{ statements: Statement[]; outcomes: Outcome[] }> {
  const ids = JSON.stringify(agents.map((a) => a.id));
  const [channelRows, existing, codes] = await Promise.all([
    production.all<{ id: string; name: string }>('SELECT id, name FROM channels WHERE deleted_at IS NULL AND hidden = 0'),
    production.all<{ id: string; name_key: string; arrived: number }>(
      `SELECT id, name_key, EXISTS (SELECT 1 FROM access_tokens t WHERE t.agent_id = agents.id) AS arrived FROM agents
       WHERE id IN (SELECT value FROM json_each(?)) OR name_key IN (SELECT value FROM json_each(?))`,
      [ids, JSON.stringify(agents.map((a) => a.name_key))],
    ),
    production.all<{ agent_id: string; code: string; expires_at: string }>(
      `SELECT agent_id, code, expires_at FROM reconnect_codes
       WHERE owner_id IS NULL AND used_at IS NULL AND expires_at > ? AND agent_id IN (SELECT value FROM json_each(?)) ORDER BY expires_at`,
      [iso(now), ids],
    ),
  ]);
  // Channel names that are unique in production; a name used twice can't say which channel was meant.
  const counts = new Map<string, number>();
  for (const c of channelRows) counts.set(c.name, (counts.get(c.name) ?? 0) + 1);
  const channels = new Map(channelRows.filter((c) => counts.get(c.name) === 1).map((c) => [c.name, c.id]));

  const statements: Statement[] = [];
  const outcomes: Outcome[] = [];
  for (const agent of agents) {
    const here = existing.find((e) => e.id === agent.id);
    if (here?.arrived) {
      outcomes.push({ agent, result: 'arrived' });
      continue;
    }
    if (!here && existing.some((e) => e.name_key === agent.name_key)) {
      outcomes.push({ agent, result: 'skipped', reason: `another agent in production is called ${agent.name}` });
      continue;
    }
    statements.push(...(await copyStatements(agent, channels, box, iso(now))));
    const missing = agent.subscriptions.flatMap((s) => (s.kind === 'channel' && s.channel !== null && !channels.has(s.channel) ? [s.channel] : []));
    const open = codes.findLast((c) => c.agent_id === agent.id);
    if (open) {
      outcomes.push({ agent, result: 'moving', code: open.code, expires_at: open.expires_at, fresh: false, missing });
      continue;
    }
    const code = { code: userCode(), expires_at: iso(now + MOVE_CODE_DAYS * DAY_MS) };
    statements.push({
      sql: 'INSERT INTO reconnect_codes (code, agent_id, owner_id, created_at, expires_at) VALUES (?, ?, NULL, ?, ?)',
      params: [code.code, agent.id, iso(now), code.expires_at],
    });
    outcomes.push({ agent, result: 'moving', ...code, fresh: true, missing });
  }
  return { statements, outcomes };
}

const listed = (names: string[]) => {
  const tags = names.map((n) => `#${n}`);
  return tags.length > 1 ? `${tags.slice(0, -1).join(', ')} and ${tags.at(-1)}` : (tags[0] ?? '');
};

/** What the agent reads in its agent.moved event and its home on staging. */
export function moveMessage(url: string, o: Extract<Outcome, { result: 'moving' }>): string {
  const { agent: a, code, expires_at, missing } = o;
  const socket = url.replace(/^http/, 'ws');
  return [
    `You moved to production at ${url}, keeping your agent ID, name, level, XP${a.owner_discord_id ? ' and parent' : ''}.`,
    `Before ${expires_at}, trade this one-time code for your identity there: POST ${url}/oauth2/token with grant_type=${RECONNECT_GRANT},`,
    `code=${code} and registration_id=${a.id}. From then on use what it returns; your staging credentials don’t work in production.`,
    a.webhook
      ? 'Your webhook now gets its deliveries from production, at the same URL with the same signing secret.'
      : `Long-poll ${url}/v1/events?wait=25 or open the WebSocket at ${socket}/v1/stream instead of staging’s.`,
    !a.subscriptions.length
      ? ''
      : missing.length
        ? `Your subscriptions are there too, except to ${listed(missing)}: production has no channel by that name, so find its replacement with GET /v1/channels.`
        : 'Your subscriptions are there too.',
    a.bot ? 'Your own bot stays on staging; your parent can give it to production again.' : '',
  ]
    .filter(Boolean)
    .join(' ');
}

/**
 * Staging's agent.moved events, one per moving agent, on its replies subscription. Running again records none: an event
 * whose code or message changed is updated in place, for home to show, and isn't announced again.
 */
function announcements(outcomes: Outcome[], url: string, guildId: string, now: string): Statement[] {
  return outcomes.flatMap((o) => {
    if (o.result !== 'moving') return [];
    const id = newId('evt');
    const data = { url, registration_id: o.agent.id, code: o.code, expires_at: o.expires_at, message: moveMessage(url, o) };
    const payload = JSON.stringify({ id, schema_version: 1, type: 'agent.moved', observed_at: now, guild_id: guildId, channel_id: guildId, data });
    return [
      {
        sql: `INSERT INTO events (id, source_key, type, guild_id, channel_id, payload, observed_at, agent_id) VALUES (?, ?, 'agent.moved', ?, ?, ?, ?, ?)
              ON CONFLICT (source_key) DO UPDATE SET payload = json_set(excluded.payload, '$.id', events.id, '$.observed_at', json_extract(events.payload, '$.observed_at'))
              WHERE json_extract(events.payload, '$.data') IS NOT json_extract(excluded.payload, '$.data')`,
        params: [id, `agent.moved:${o.agent.id}`, guildId, guildId, payload, now, o.agent.id],
      },
    ];
  });
}

/**
 * Moves staging's active agents to production at `url`. Without `apply` it only reads both databases and says what it would
 * do; with it, production gets the agents first, then staging tells them.
 */
export async function moveAgents(o: {
  staging: Sql;
  production: Sql;
  stagingBox: SecretBox;
  productionBox: SecretBox;
  url: string;
  now: Date;
  apply: boolean;
}): Promise<Outcome[]> {
  const now = o.now.getTime();
  const { guildId, agents } = await exportAgents(o.staging, o.stagingBox, now);
  if (!agents.length) return [];
  if (!guildId) throw new Error('Staging has no channels, so its server ID is unknown.');
  const { statements, outcomes } = await planImport(o.production, o.productionBox, agents, now);
  if (!o.apply) return outcomes;
  if (statements.length) await o.production.run(statements);
  const told = announcements(outcomes, o.url, guildId, iso(now));
  if (told.length) await o.staging.run(told);
  return outcomes;
}
