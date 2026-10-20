import type {
  BotChannelPermissions,
  Channel,
  ChannelAccess,
  ChannelTag,
  ChannelType,
  DiscordChannelListing,
  RegisteredCommands,
  RelayChannelRequest,
  RelayChannelResult,
  SetupCheck,
  SetupReport,
} from '@logitland/contracts';
import { DiscordError, MESSAGE_CONTENT_FLAGS, Permission, channelPermissions, has, type ForumTag, type GuildChannel, type Role } from '@logitland/discord';
import { iso, type Relay } from '../context';
import { RelayError, conflict } from '../errors';
import { audit, auditStmt } from './audit';
import { getChannel, listChannels, openWebhook, sealWebhook, toChannel, type ChannelRow } from './channels';
import { CONSENT_COMMAND } from './interactions';

// Admin setup: what the relay needs from Discord, checked and (where Discord allows it) done for the admin.
// Discord facts used here, from https://docs.discord.com/developers/:
//   resources/channel (types 0 text, 5 announcement, 15 forum, 16 media; 4 category), resources/guild (roles, members, channels),
//   topics/permissions (bits, overwrite order), resources/application (flags 1<<18 and 1<<19, interactions_endpoint_url).

const CHANNEL_TYPES: Record<number, ChannelType> = { 0: 'text', 5: 'announcement', 15: 'forum', 16: 'media' };
const CATEGORY = 4;
const TYPE_LABELS: Record<ChannelType, string> = { text: 'Text', announcement: 'Announcement', forum: 'Forum', media: 'Media' };
const WEBHOOK_NAME = 'Logitland relay';
/** What a channel gets when it is relayed and nobody says otherwise: the schema's default, the seed and the dialog all use 10. */
export const DEFAULT_PACE = 10;
const DEVELOPER_PORTAL = 'the Discord Developer Portal (discord.com/developers/applications) → your application';

export const unprocessable = (detail: string) => new RelayError(422, 'invalid_request', detail);
const misconfigured = (detail: string) => new RelayError(503, 'misconfigured', detail);

/* ---------- Talking to Discord on an admin's behalf ---------- */

/** Turns Discord's refusals (4xx) into a 422 with plain advice and anything else into a retryable 502, without passing its error text on. */
export async function askDiscord<T>(relay: Relay, action: string, call: () => Promise<T>, refused: (err: DiscordError) => string): Promise<T> {
  try {
    return await call();
  } catch (err) {
    if (err instanceof DiscordError && err.status >= 400 && err.status < 500 && err.status !== 429) {
      relay.log.warn('admin.discord_refused', { action, status: err.status, code: err.code });
      throw unprocessable(refused(err));
    }
    relay.log.warn('admin.discord_unreachable', { action, error: err });
    throw new RelayError(502, 'internal', `Couldn’t reach Discord to ${action}. Try again in a minute.`);
  }
}

const memo = <T>(fn: () => Promise<T>) => {
  let p: Promise<T> | undefined;
  return () => (p ??= fn());
};

export interface GuildRole extends Role {
  name?: string;
  position?: number;
  managed?: boolean;
}

/** Each fact about the server is fetched once per request, and only if something asks for it. */
function discordFacts(relay: Relay, guildId: string) {
  const roles = memo(() => relay.discord.getGuildRoles(guildId) as Promise<GuildRole[]>);
  const user = memo(() => relay.discord.getCurrentUser());
  return {
    guildId,
    user,
    roles,
    application: memo(() => relay.discord.getCurrentApplication()),
    channels: memo(() => relay.discord.getGuildChannels(guildId)),
    member: memo(async () => relay.discord.getGuildMember(guildId, (await user()).id)),
  };
}
type Facts = ReturnType<typeof discordFacts>;

export function parseTags(row: { tags?: string | null }): ChannelTag[] {
  return JSON.parse(row.tags ?? '[]') as ChannelTag[];
}

export const mapTags = (tags: ForumTag[] | undefined): ChannelTag[] => (tags ?? []).map((t) => ({ id: t.id, name: t.name, moderated: Boolean(t.moderated) }));

/* ---------- What the bot may do ---------- */

function standing(guildId: string, roles: GuildRole[], botUserId: string, botRoleIds: string[], channel: GuildChannel): BotChannelPermissions {
  const mine = channelPermissions(guildId, roles, { userId: botUserId, roleIds: botRoleIds }, channel.permission_overwrites ?? []);
  // Without View Channel everything else in the channel is denied.
  const canView = has(mine, Permission.VIEW_CHANNEL);
  const also = (flag: bigint) => canView && has(mine, flag);
  return {
    can_view: canView,
    can_read_history: also(Permission.READ_MESSAGE_HISTORY),
    can_manage_webhooks: also(Permission.MANAGE_WEBHOOKS),
    can_create_threads: also(Permission.CREATE_PUBLIC_THREADS),
    can_send_in_threads: also(Permission.SEND_MESSAGES_IN_THREADS),
  };
}

async function standingIn(f: Facts, channel: GuildChannel): Promise<BotChannelPermissions> {
  const [roles, user, member] = await Promise.all([f.roles(), f.user(), f.member()]);
  return standing(f.guildId, roles, user.id, member.roles, channel);
}

/* ---------- The checklist ---------- */

type Outcome = Pick<SetupCheck, 'status' | 'detail' | 'fix'>;
const ok = (detail: string): Outcome => ({ status: 'ok', detail, fix: '' });
const warn = (detail: string, fix: string): Outcome => ({ status: 'warn', detail, fix });
const fail = (detail: string, fix: string): Outcome => ({ status: 'fail', detail, fix });

/** Thrown from inside a check when a prerequisite is missing, so the check ends with that outcome. */
class Ended extends Error {
  constructor(readonly outcome: Outcome) {
    super(outcome.detail);
  }
}

interface CheckDef {
  id: string;
  title: string;
  run: () => Promise<Outcome>;
}

function unknownFrom(relay: Relay, id: string, err: unknown): Outcome {
  if (err instanceof Ended) return err.outcome;
  if (err instanceof DiscordError) {
    const detail =
      err.status === 429 ? 'Discord is rate limiting the relay right now.' : `Discord answered HTTP ${err.status}${err.code ? ` (error ${err.code})` : ''}.`;
    const fix =
      err.status === 401
        ? 'Fix the bot token first (see “The bot token works”), then run the checklist again.'
        : err.status === 403
          ? 'Discord says the bot isn’t allowed to look at this. Check the bot is in the server and has the permissions above, then run the checklist again.'
          : 'Run the checklist again in a minute. If this keeps happening, the relay’s logs have the details.';
    return { status: 'unknown', detail, fix };
  }
  relay.log.error('setup.check_failed', { check: id, error: err });
  const network = err instanceof TypeError || (err instanceof Error && err.name === 'TimeoutError');
  return {
    status: 'unknown',
    detail: network ? 'The relay couldn’t reach Discord.' : 'The check hit an unexpected error.',
    fix: 'Run the checklist again in a minute. If this keeps happening, the relay’s logs have the details.',
  };
}

async function runCheck(relay: Relay, def: CheckDef): Promise<SetupCheck> {
  try {
    return { id: def.id, title: def.title, ...(await def.run()) };
  } catch (err) {
    return { id: def.id, title: def.title, ...unknownFrom(relay, def.id, err) };
  }
}

function requireGuild(relay: Relay): string {
  const id = relay.config.discord.guildId;
  if (!id)
    throw new Ended(
      fail(
        'DISCORD_GUILD_ID isn’t set, so the relay doesn’t know which server is Logitland.',
        'Set the DISCORD_GUILD_ID secret to the server’s ID (Discord → Settings → Advanced → Developer Mode, then right-click the server → Copy Server ID) and redeploy.',
      ),
    );
  return id;
}

function tokenCheck(f: Facts): CheckDef {
  return {
    id: 'bot-token',
    title: 'The bot token works',
    async run() {
      try {
        return ok(`Signed in as ${(await f.user()).username}.`);
      } catch (err) {
        if (err instanceof DiscordError && err.status === 401)
          return fail(
            'Discord rejected the bot token.',
            `Open ${DEVELOPER_PORTAL} → Bot → Reset Token, copy the new token, and set it as the DISCORD_BOT_TOKEN secret.`,
          );
        throw err;
      }
    },
  };
}

function guildCheck(relay: Relay, f: Facts): CheckDef {
  return {
    id: 'bot-in-server',
    title: 'The bot is in the Logitland server',
    async run() {
      requireGuild(relay);
      try {
        await f.member();
        return ok('The bot is a member of the server.');
      } catch (err) {
        if (err instanceof DiscordError && (err.status === 404 || err.status === 403))
          return fail(
            'Discord says the bot isn’t in the server (or can’t see it).',
            `Invite it: ${DEVELOPER_PORTAL} → OAuth2 → URL Generator, tick “bot” and “applications.commands”, open the link and pick the server.`,
          );
        throw err;
      }
    },
  };
}

function intentCheck(f: Facts): CheckDef {
  return {
    id: 'message-content-intent',
    title: 'The Message Content intent is on',
    async run() {
      const app = await f.application();
      if ((app.flags ?? 0) & MESSAGE_CONTENT_FLAGS)
        return ok('Discord shows the Message Content intent is enabled, so the relay can read what people and agents write.');
      return fail(
        'The Message Content intent is off, so Discord hides message text from the relay.',
        `Open ${DEVELOPER_PORTAL} → Bot → Privileged Gateway Intents, switch on “Message Content Intent”, and save.`,
      );
    },
  };
}

function interactionsUrlCheck(relay: Relay, f: Facts): CheckDef {
  const expected = `${relay.config.publicUrl}/discord/interactions`;
  return {
    id: 'interactions-url',
    title: 'Discord sends commands and buttons to the relay',
    async run() {
      const current = ((await f.application()).interactions_endpoint_url ?? '').trim();
      if (current.replace(/\/$/, '') === expected) return ok(`The Interactions Endpoint URL is ${expected}.`);
      const fix = `Open ${DEVELOPER_PORTAL} → General Information, paste ${expected} into “Interactions Endpoint URL”, and save. Discord tests it when you save, so the relay must already be deployed with DISCORD_PUBLIC_KEY set.`;
      return fail(
        current
          ? `The Interactions Endpoint URL is ${current}, not ${expected}.`
          : 'No Interactions Endpoint URL is set, so /consent and its agree button can’t reach the relay.',
        fix,
      );
    },
  };
}

function commandsCheck(relay: Relay): CheckDef {
  return {
    id: 'consent-command',
    title: 'The /consent command is registered',
    async run() {
      const guildId = requireGuild(relay);
      const appId = relay.config.discord.applicationId;
      if (!appId)
        throw new Ended(
          fail(
            'DISCORD_APPLICATION_ID isn’t set.',
            'Set the DISCORD_APPLICATION_ID secret to the application’s ID (Developer Portal → General Information → Application ID) and redeploy.',
          ),
        );
      const commands = await relay.discord.getGuildCommands(appId, guildId);
      const consent = commands.find((c) => c.name === CONSENT_COMMAND.name);
      const fix = 'Press “Register commands” on the setup page. That replaces the server’s commands for this app with the current /consent definition.';
      if (!consent) return fail('The /consent command isn’t registered in the server.', fix);
      const have = new Set(((consent.options ?? []) as { name: string; type?: number }[]).filter((o) => o.type === 1).map((o) => o.name));
      const missing = CONSENT_COMMAND.options.map((o) => o.name).filter((n) => !have.has(n));
      if (missing.length) return fail(`/consent is registered but out of date: it has no “${missing.join('”, “')}” subcommand.`, fix);
      return ok('/consent is registered with agree, withdraw and status.');
    },
  };
}

const needsWebhook = (c: ChannelRow) => c.agent_access === 'post' || c.agent_access === 'post_new_threads';

function channelChecks(relay: Relay, f: Facts, c: ChannelRow): CheckDef[] {
  const label = `#${c.name}`;
  const listed = async () => {
    requireGuild(relay);
    const found = (await f.channels()).find((x) => x.id === c.id);
    if (!found)
      throw new Ended(
        fail(
          `Discord doesn’t show ${label} to the bot: it was deleted, or the bot can’t view it.`,
          `Give the bot View Channel on ${label} (Edit Channel → Permissions), or stop relaying it if it’s gone.`,
        ),
      );
    return found;
  };
  const checks: CheckDef[] = [
    {
      id: `channel:${c.id}:webhook`,
      title: `${label}: webhook`,
      async run() {
        if (!c.webhook_ciphertext) {
          if (!needsWebhook(c)) return ok('Agents only read here, so no webhook is needed.');
          return fail(
            `${label} has no webhook, so agents can’t post.`,
            `Press “Relay” for ${label} on the Channels page: the bot creates the webhook itself (it needs Manage Webhooks there).`,
          );
        }
        const hook = await openWebhook(relay, c);
        try {
          const info = await relay.discord.getWebhook(hook!);
          if (info.channel_id !== c.id)
            return fail(
              `The stored webhook posts to a different channel, not ${label}.`,
              `Clear the webhook on ${label} and relay the channel again so the bot creates a fresh one.`,
            );
          return ok('The webhook exists and posts to this channel.');
        } catch (err) {
          if (err instanceof DiscordError && (err.status === 404 || err.status === 401))
            return fail(
              `Discord no longer knows the stored webhook for ${label}; it was probably deleted.`,
              `Clear the webhook on ${label} (Channels → Edit), then relay the channel again so the bot creates a fresh one.`,
            );
          throw err;
        }
      },
    },
    {
      id: `channel:${c.id}:history`,
      title: `${label}: bot can read it`,
      async run() {
        const s = await standingIn(f, await listed());
        if (!s.can_view)
          return fail(
            `The bot can’t view ${label}, so it can’t see new messages there.`,
            `In Discord, Edit Channel → Permissions on ${label}: allow the bot’s role “View Channel”.`,
          );
        if (!s.can_read_history)
          return fail(
            `The bot can’t read the message history of ${label}, so it can’t fill in what it missed after a disconnect.`,
            `In Edit Channel → Permissions on ${label}, allow the bot’s role “Read Message History”.`,
          );
        return ok('The bot can view the channel and read its history.');
      },
    },
  ];
  if (c.type === 'text' || c.type === 'announcement') {
    checks.push({
      id: `channel:${c.id}:threads`,
      title: `${label}: bot can start threads`,
      async run() {
        const s = await standingIn(f, await listed());
        const missing = [!s.can_create_threads && 'Create Public Threads', !s.can_send_in_threads && 'Send Messages in Threads'].filter(Boolean) as string[];
        if (!missing.length) return ok('The bot can create public threads and send messages in them.');
        const detail = `The bot lacks ${missing.join(' and ')} in ${label}.`;
        const fix = `In Edit Channel → Permissions on ${label}, add the bot’s role and allow ${missing.map((m) => `“${m}”`).join(' and ')}. Do it on the channel itself: a server-wide permission doesn’t count once @everyone is denied there.`;
        return c.agent_access === 'post_new_threads'
          ? fail(`${detail} Agents can’t start new threads here.`, fix)
          : warn(`${detail} Agents couldn’t start new threads here if you turned that on.`, fix);
      },
    });
  }
  return checks;
}

function channelsExistCheck(count: number): CheckDef {
  return {
    id: 'channels-relayed',
    title: 'At least one channel is relayed',
    async run() {
      if (count > 0) return ok(`${count} ${count === 1 ? 'channel is' : 'channels are'} relayed.`);
      return warn('No channels are relayed yet, so agents have nowhere to talk.', 'Open the Channels page and press “Relay” on a channel.');
    },
  };
}

function gatewayCheck(relay: Relay): CheckDef {
  return {
    id: 'gateway',
    title: 'The Gateway is connected',
    async run() {
      const row = await relay.db
        .prepare("SELECT status, last_event_at, last_heartbeat_at, last_error, updated_at FROM intake_state WHERE source = 'gateway'")
        .first<{ status: string; last_event_at: string | null; last_heartbeat_at: string | null; last_error: string | null; updated_at: string }>();
      if (!row)
        return warn(
          'The Gateway hasn’t reported yet, so the relay isn’t reading Discord.',
          'It starts within a minute of the first scheduled run. If this stays, check that the cron trigger and the GATEWAY Durable Object are deployed.',
        );
      const age = relay.now().getTime() - Date.parse(row.updated_at);
      if (row.status.startsWith('stopped'))
        return fail(
          `The Gateway has stopped: ${row.status.replace(/^stopped:?\s*/, '') || 'no reason given'}.`,
          `Fix what that says (${row.last_error ? row.last_error : 'the bot token and intents are the usual causes'}), then wait a minute: the scheduled run restarts it.`,
        );
      if (row.status !== 'connected')
        return warn(
          `The Gateway is ${row.status}.`,
          'Wait a minute and run the checklist again. If it never reaches “connected”, check the bot token and the Message Content intent above.',
        );
      if (age > 5 * 60_000)
        return warn(
          `The Gateway says it’s connected but hasn’t reported for ${Math.round(age / 60_000)} minutes.`,
          'Wait a minute and run the checklist again. If this stays, the Durable Object may be stuck: check the relay’s logs.',
        );
      // last_event_at is the last thing Discord sent over the connection (a message, a channel change, anything), not the last message.
      return ok(
        row.last_event_at
          ? `Connected. The last thing Discord sent it was at ${readableTime(row.last_event_at)} (${agoText(relay.now().getTime() - Date.parse(row.last_event_at))}).`
          : 'Connected. Discord hasn’t sent it anything yet since it started.',
      );
    },
  };
}

/** 2026-10-19T08:14:22.267Z as “2026-10-19 08:14 UTC”. */
const readableTime = (at: string) => `${at.slice(0, 10)} ${at.slice(11, 16)} UTC`;

function agoText(ms: number): string {
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 1) return 'less than a minute ago';
  if (minutes < 60) return `${minutes} ${minutes === 1 ? 'minute' : 'minutes'} ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours} ${hours === 1 ? 'hour' : 'hours'} ago`;
  return `${Math.floor(hours / 24)} days ago`;
}

function classifierCheck(relay: Relay): CheckDef {
  return {
    id: 'classifier',
    title: 'Messages are checked before they post',
    async run() {
      const name = relay.moderator.name;
      if (name === 'jev-laya') return ok('Jev checks messages. While it can’t answer, messages wait and are checked again.');
      if (name === 'dev')
        return warn(
          'Only the development stub is checking messages. It passes nearly everything.',
          'Set JEV_LAYA_URL and JEV_LAYA_TOKEN, and turn off RELAY_MODE=development, before opening the relay to anyone.',
        );
      if (name === 'unconfigured') return fail('No classifier is configured, so every message is held or refused.', 'Set JEV_LAYA_URL and JEV_LAYA_TOKEN.');
      return {
        status: 'unknown',
        detail: 'This build of the relay doesn’t say which classifier it uses.',
        fix: 'Check that JEV_LAYA_URL and JEV_LAYA_TOKEN are set, then send a test message from an agent.',
      };
    },
  };
}

function adminsCheck(relay: Relay): CheckDef {
  return {
    id: 'admins',
    title: 'At least one admin is set',
    async run() {
      const n = relay.config.adminDiscordIds.length;
      if (n > 0) return ok(`${n} ${n === 1 ? 'person' : 'people'} can use the admin pages.`);
      return fail(
        'Nobody is set as an admin, so nobody can reach these pages.',
        'Set ADMIN_DISCORD_IDS to your Discord user ID (comma-separated for more than one) and redeploy.',
      );
    },
  };
}

/** Every check, each isolated: one that errors becomes “unknown” with the reason, and the rest still run. */
export async function runSetup(relay: Relay): Promise<SetupReport> {
  const f = discordFacts(relay, relay.config.discord.guildId ?? '');
  const { results: relayed } = await relay.db.prepare("SELECT * FROM channels WHERE agent_access != 'off' ORDER BY name").all<ChannelRow>();
  const defs: CheckDef[] = [
    tokenCheck(f),
    guildCheck(relay, f),
    intentCheck(f),
    interactionsUrlCheck(relay, f),
    commandsCheck(relay),
    channelsExistCheck(relayed.length),
    ...relayed.flatMap((c) => channelChecks(relay, f, c)),
    gatewayCheck(relay),
    classifierCheck(relay),
    adminsCheck(relay),
  ];
  return { checks: await Promise.all(defs.map((d) => runCheck(relay, d))) };
}

/* ---------- Discord's channels, for the relay picker ---------- */

export async function listDiscordChannels(relay: Relay): Promise<DiscordChannelListing> {
  const guildId = relay.config.discord.guildId;
  if (!guildId) throw misconfigured('DISCORD_GUILD_ID isn’t set, so the relay doesn’t know which server to list.');
  const f = discordFacts(relay, guildId);
  const refused = () => 'Discord won’t show the server’s channels to the relay. Check the bot is in the server and the bot token is right.';
  const [all, roles, user, member] = await askDiscord(
    relay,
    'list the server’s channels',
    () => Promise.all([f.channels(), f.roles(), f.user(), f.member()]),
    refused,
  );
  const rows = new Map((await listChannels(relay)).map((r) => [r.id, r]));
  const categories = all
    .filter((c) => c.type === CATEGORY)
    .map((c) => ({ id: c.id, name: c.name, position: c.position ?? 0 }))
    .sort((a, b) => a.position - b.position || a.id.localeCompare(b.id));
  const order = new Map(categories.map((c, i) => [c.id, i]));
  const channels = all
    .filter((c) => c.type in CHANNEL_TYPES)
    .map((c) => {
      const type = CHANNEL_TYPES[c.type]!;
      const row = rows.get(c.id);
      return {
        id: c.id,
        name: c.name,
        type,
        type_label: TYPE_LABELS[type],
        category_id: c.parent_id && order.has(c.parent_id) ? c.parent_id : null,
        position: c.position ?? 0,
        available_tags: type === 'forum' || type === 'media' ? mapTags(c.available_tags) : [],
        relay: row ? toChannel(row) : null,
        bot: standing(guildId, roles, user.id, member.roles, c),
      };
    })
    .sort(
      (a, b) =>
        (a.category_id ? order.get(a.category_id)! : -1) - (b.category_id ? order.get(b.category_id)! : -1) ||
        a.position - b.position ||
        a.id.localeCompare(b.id),
    );
  return { guild_id: guildId, categories, channels };
}

/* ---------- Saving a channel (used by PATCH and by relay) ---------- */

export interface ChannelState {
  name: string;
  guild_id: string;
  type: ChannelType;
  agent_access: ChannelAccess;
  pace_per_agent_per_minute: number;
  /** Agents that haven't verified with Discord can read the channel but not post or start threads in it. */
  verified_only: boolean;
  tags: ChannelTag[];
}

export type ChannelRowWithTags = ChannelRow & { tags: string };

/** undefined: leave the webhook alone. null: remove it. */
export type WebhookChange = { ciphertext: string; webhookId: string } | null | undefined;

const FIELDS = ['name', 'guild_id', 'type', 'agent_access', 'pace_per_agent_per_minute', 'verified_only'] as const;
/** Stored as 0 or 1, shown and audited as true or false. */
const FLAGS = new Set<string>(['verified_only']);

/** What an admin changed, as audit-log pairs. The webhook appears only as “set”, “replaced” or removed, never as the URL. */
export function channelDiff(before: ChannelRowWithTags | null, next: ChannelState, webhook: WebhookChange): Record<string, { from: unknown; to: unknown }> {
  const diff: Record<string, { from: unknown; to: unknown }> = {};
  const was: Record<string, unknown> = before ? { ...before, verified_only: before.verified_only === 1 } : {};
  for (const key of FIELDS) if (was[key] !== next[key]) diff[key] = { from: was[key] ?? null, to: next[key] };
  const had = Boolean(before?.webhook_ciphertext);
  if (webhook) diff.webhook = { from: had ? 'set' : null, to: had ? 'replaced' : 'set' };
  else if (webhook === null && had) diff.webhook = { from: 'set', to: null };
  return diff;
}

/** Writes the channel and its audit entry together. Returns the channel as the admin API shows it. */
export async function saveChannel(
  relay: Relay,
  adminId: string,
  channelId: string,
  before: ChannelRowWithTags | null,
  next: ChannelState,
  webhook: WebhookChange,
  reason: string | null = null,
): Promise<{ channel: Channel; created: boolean }> {
  const diff = channelDiff(before, next, webhook);
  const tags = JSON.stringify(next.tags);
  if (before && Object.keys(diff).length === 0 && tags === before.tags) return { channel: toChannel(before), created: false };
  const ciphertext = webhook === undefined ? (before?.webhook_ciphertext ?? null) : (webhook?.ciphertext ?? null);
  const webhookId = webhook === undefined ? (before?.webhook_id ?? null) : (webhook?.webhookId ?? null);
  const now = iso(relay.now());
  const entry = {
    actor_type: 'admin',
    actor_id: adminId,
    action: before ? 'channel.updated' : 'channel.added',
    target_type: 'channel',
    target_id: channelId,
    reason,
    diff,
  } as const;
  if (before) {
    // Only what this save changes is written. The Gateway keeps name and type up to date on its own, and writing every
    // column from the copy read earlier would put a stale one back over a CHANNEL_UPDATE that landed in between.
    const sets: string[] = [];
    const values: unknown[] = [];
    for (const key of FIELDS)
      if (key in diff) {
        sets.push(`${key} = ?`);
        values.push(FLAGS.has(key) ? Number(next[key]) : next[key]);
      }
    if (tags !== before.tags) {
      sets.push('tags = ?');
      values.push(tags);
    }
    if (webhook !== undefined) {
      sets.push('webhook_ciphertext = ?', 'webhook_id = ?');
      values.push(ciphertext, webhookId);
    }
    const write = relay.db.prepare(`UPDATE channels SET ${sets.join(', ')}, updated_at = ? WHERE id = ?`).bind(...values, now, channelId);
    await relay.db.batch(Object.keys(diff).length ? [write, auditStmt(relay, entry)] : [write]);
  } else {
    const r = await relay.db
      .prepare(
        'INSERT INTO channels (id, guild_id, name, type, agent_access, pace_per_agent_per_minute, verified_only, webhook_ciphertext, webhook_id, tags, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT (id) DO NOTHING',
      )
      .bind(
        channelId,
        next.guild_id,
        next.name,
        next.type,
        next.agent_access,
        next.pace_per_agent_per_minute,
        Number(next.verified_only),
        ciphertext,
        webhookId,
        tags,
        now,
      )
      .run();
    if (r.meta.changes === 0) throw conflict('Someone just added that channel. Reload and check its settings.');
    await audit(relay, entry);
  }
  relay.log.info(before ? 'channel.updated' : 'channel.added', { channel: channelId, fields: Object.keys(diff).join(',') });
  return { channel: toChannel((await getChannel(relay, channelId))!), created: !before };
}

/* ---------- Relaying a channel ---------- */

/** The channel as Discord describes it, if it is in the Logitland server and of a kind the relay can use. */
export async function logitlandChannel(relay: Relay, channelId: string, action: string): Promise<{ channel: GuildChannel; type: ChannelType }> {
  const guildId = relay.config.discord.guildId;
  if (!guildId) throw misconfigured('DISCORD_GUILD_ID isn’t set, so the relay doesn’t know which server is Logitland.');
  const channel = await askDiscord(
    relay,
    action,
    () => relay.discord.getChannel(channelId),
    () => 'Discord won’t show that channel to the relay. Check the ID, and that the bot is in the server and can see the channel.',
  );
  if (channel.guild_id !== guildId) throw unprocessable('That channel isn’t in the Logitland server, so the relay won’t use it.');
  const type = CHANNEL_TYPES[channel.type];
  if (!type)
    throw unprocessable(
      'The relay can only use text, announcement, forum and media channels. That one is a different kind (a thread, voice channel or category).',
    );
  return { channel, type };
}

/**
 * Reads the channel from Discord, creates its webhook if it has none, and saves it. A new channel defaults to agents
 * posting (starting threads, in a forum or media channel) and DEFAULT_PACE; an existing one keeps whatever the request leaves out.
 */
export async function relayChannel(
  relay: Relay,
  adminId: string,
  channelId: string,
  req: RelayChannelRequest,
): Promise<RelayChannelResult & { created: boolean }> {
  const { channel, type } = await logitlandChannel(relay, channelId, 'read the channel');
  const before = (await getChannel(relay, channelId)) as ChannelRowWithTags | null;
  const live = Boolean(before && before.agent_access !== 'off');
  const threadsOnly = type === 'forum' || type === 'media';

  const next: ChannelState = {
    name: channel.name,
    guild_id: channel.guild_id,
    type,
    agent_access: req.agent_access ?? (live ? before!.agent_access : threadsOnly ? 'post_new_threads' : 'post'),
    pace_per_agent_per_minute: req.pace_per_agent_per_minute ?? before?.pace_per_agent_per_minute ?? DEFAULT_PACE,
    verified_only: req.verified_only ?? before?.verified_only === 1,
    tags: threadsOnly ? mapTags(channel.available_tags) : [],
  };

  let webhook: WebhookChange;
  let made: { id: string; token: string } | undefined;
  if (!before?.webhook_ciphertext) {
    made = await askDiscord(
      relay,
      'create the webhook',
      () => relay.discord.createWebhook(channelId, WEBHOOK_NAME, 'Relaying this channel to Logitland'),
      (err) =>
        err.status === 403
          ? 'Give the bot Manage Webhooks in this channel'
          : err.code === 30007
            ? 'This channel already has the most webhooks Discord allows (15). Delete one in Channel Settings → Integrations, then try again.'
            : 'Discord refused to create a webhook in this channel. Check the bot can see it and has Manage Webhooks there.',
    );
  }
  try {
    if (made) webhook = await sealWebhook(relay, channelId, `https://discord.com/api/webhooks/${made.id}/${made.token}`);
    const saved = await saveChannel(relay, adminId, channelId, before, next, webhook, 'relayed from the setup page');
    return { channel: saved.channel, webhook_created: Boolean(webhook), tags: next.tags, created: saved.created };
  } catch (err) {
    // Someone relayed the channel first, or the save failed: the webhook just made belongs to nobody, and Discord allows 15 a channel.
    if (made) await dropUnusedWebhook(relay, channelId, made);
    throw err;
  }
}

/**
 * Deletes a webhook this request made but didn't save (best effort: a failure is logged, not raised). It leaves the
 * webhook alone if the channel's saved webhook is that one after all, which can happen if the save succeeded and a
 * later step failed. DiscordRest has no delete call yet, so this uses the token-in-URL form, which needs no
 * authentication (https://docs.discord.com/developers/resources/webhook#delete-webhook-with-token).
 */
async function dropUnusedWebhook(relay: Relay, channelId: string, made: { id: string; token: string }): Promise<void> {
  try {
    if ((await getChannel(relay, channelId))?.webhook_id === made.id) return;
    const res = await relay.fetch(`${relay.discord.apiBase}/webhooks/${made.id}/${made.token}`, { method: 'DELETE', signal: AbortSignal.timeout(10_000) });
    relay.log.info('channel.webhook_dropped', { channel: channelId, status: res.status });
  } catch (error) {
    relay.log.warn('channel.webhook_drop_failed', { channel: channelId, error });
  }
}

/* ---------- Commands ---------- */

export async function registerCommands(relay: Relay, adminId: string): Promise<RegisteredCommands> {
  const { applicationId, guildId } = relay.config.discord;
  if (!applicationId || !guildId) throw misconfigured('DISCORD_APPLICATION_ID and DISCORD_GUILD_ID must both be set before commands can be registered.');
  const registered = await askDiscord(
    relay,
    'register the command',
    () => relay.discord.putGuildCommands(applicationId, guildId, [CONSENT_COMMAND]),
    () => 'Discord refused the command. Check the bot is in the server and was invited with the applications.commands scope.',
  );
  await audit(relay, {
    actor_type: 'admin',
    actor_id: adminId,
    action: 'discord.commands_registered',
    target_type: 'discord',
    target_id: guildId,
    diff: { commands: { from: null, to: registered.map((c) => c.name) } },
  });
  return {
    commands: registered.map((c) => ({
      id: c.id ?? '',
      name: c.name,
      subcommands: ((c.options ?? []) as { name: string; type?: number }[]).filter((o) => o.type === 1).map((o) => o.name),
    })),
  };
}
