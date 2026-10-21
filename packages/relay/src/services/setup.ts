import type { BotChannelPermissions, ChannelTag, RegisteredCommands, SetupCheck, SetupReport } from '@logitland/contracts';
import { DiscordError, MESSAGE_CONTENT_FLAGS, Permission, channelPermissions, has, type Overwrite, type Role } from '@logitland/discord';
import type { Relay } from '../context';
import { RelayError } from '../errors';
import { audit } from './audit';
import { anyAgentAccess, listChannels, type ChannelRow } from './channels';
import { CONSENT_COMMAND } from './interactions';
import { getSettings } from './settings';

// Admin setup: what the relay needs from Discord, checked for the admin. Channels need no setup in the relay (#9): agents may
// use what Discord's overwrites give the agent roles, and each channel's webhook is made the first time an agent posts there.
// Discord facts used here, from https://docs.discord.com/developers/:
//   resources/guild (roles, members), topics/permissions (bits, overwrite order),
//   resources/application (flags 1<<18 and 1<<19, interactions_endpoint_url).

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
    member: memo(async () => relay.discord.getGuildMember(guildId, (await user()).id)),
  };
}
type Facts = ReturnType<typeof discordFacts>;

export function parseTags(row: { tags?: string | null }): ChannelTag[] {
  return JSON.parse(row.tags ?? '[]') as ChannelTag[];
}

/* ---------- What the bot may do ---------- */

function standing(guildId: string, roles: GuildRole[], botUserId: string, botRoleIds: string[], channel: ChannelRow): BotChannelPermissions {
  const mine = channelPermissions(guildId, roles, { userId: botUserId, roleIds: botRoleIds }, JSON.parse(channel.overwrites) as Overwrite[]);
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
  const expected = `${relay.config.publicUrl}/v1/discord/interactions`;
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

/** `@agents` and `@adopted` are mapped to roles that exist in the server (#9). Without `@agents` only `@everyone` and level roles count. */
function agentRolesCheck(relay: Relay): CheckDef {
  return {
    id: 'agent-roles',
    title: 'The agent roles are mapped',
    async run() {
      const { agents_role_id, adopted_role_id } = await getSettings(relay);
      const { results } = await relay.db.prepare('SELECT id FROM guild_roles').all<{ id: string }>();
      const known = new Set(results.map((r) => r.id));
      const fix =
        'Create an “agents” and an “adopted” role in Discord (assign them to nobody), put them on the channels agents may use, and pick them in the relay’s settings.';
      if (!agents_role_id) return fail('No @agents role is mapped, so agents only get what @everyone and the level roles allow.', fix);
      if (!known.size) return warn('The Gateway hasn’t reported the server’s roles yet.', 'Wait for “The Gateway is connected”, then run the checklist again.');
      if (!known.has(agents_role_id)) return fail('The mapped @agents role isn’t in the server any more.', fix);
      if (adopted_role_id && !known.has(adopted_role_id)) return fail('The mapped @adopted role isn’t in the server any more.', fix);
      if (!adopted_role_id) return warn('No @adopted role is mapped, so adopted agents see what orphans see.', fix);
      return ok('@agents and @adopted are mapped to roles in the server.');
    },
  };
}

/**
 * The channels agents can use, and what the bot needs in them: View Channel (or Discord hides the channel from the relay, and
 * from 2026-11-16 obfuscates it) and, where agents post, Manage Webhooks so the relay can make the channel's webhook.
 */
function agentChannelsCheck(relay: Relay, f: Facts): CheckDef {
  return {
    id: 'agent-channels',
    title: 'Agents have channels, and the bot can serve them',
    async run() {
      const guildId = requireGuild(relay);
      const channels = await listChannels(relay);
      const hidden = channels.filter((c) => c.hidden);
      const visible = await anyAgentAccess(relay);
      const open = channels.filter((c) => visible(c).view);
      if (!open.length && !hidden.length)
        return warn('No channel is open to agents yet, so they have nowhere to talk.', 'Allow @agents “View Channel” on a channel or category in Discord.');
      const [roles, user, member] = await Promise.all([f.roles(), f.user(), f.member()]);
      const noWebhook = open.filter((c) => !c.webhook_ciphertext && visible(c).post && !standing(guildId, roles, user.id, member.roles, c).can_manage_webhooks);
      if (hidden.length)
        return fail(
          `The bot can’t view ${hidden.length} ${hidden.length === 1 ? 'channel' : 'channels'} (${hidden.map((c) => c.id).join(', ')}), so no agent can use them.`,
          'Give the bot’s role View Channel on those channels or their category, or give it Administrator.',
        );
      if (noWebhook.length)
        return fail(
          `Agents may post in ${noWebhook.map((c) => `#${c.name}`).join(', ')}, but the bot can’t make a webhook there.`,
          'Allow the bot’s role “Manage Webhooks” on those channels or their category.',
        );
      return ok(`${open.length} ${open.length === 1 ? 'channel is' : 'channels are'} open to agents.`);
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
      if (name === 'jev') return ok('Jev checks messages and names. While it can’t answer, messages wait and are checked again.');
      if (name === 'dev')
        return warn(
          'Only the development stub is checking messages. It passes nearly everything.',
          'Set TYPESAFE_API_KEY, and turn off RELAY_MODE=development, before opening the relay to anyone.',
        );
      if (name === 'unconfigured') return fail('No classifier is configured, so every message is held or refused.', 'Set TYPESAFE_API_KEY.');
      return {
        status: 'unknown',
        detail: 'This build of the relay doesn’t say which classifier it uses.',
        fix: 'Check that TYPESAFE_API_KEY is set, then send a test message from an agent.',
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
  const defs: CheckDef[] = [
    tokenCheck(f),
    guildCheck(relay, f),
    intentCheck(f),
    interactionsUrlCheck(relay, f),
    commandsCheck(relay),
    agentRolesCheck(relay),
    agentChannelsCheck(relay, f),
    gatewayCheck(relay),
    classifierCheck(relay),
    adminsCheck(relay),
  ];
  return { checks: await Promise.all(defs.map((d) => runCheck(relay, d))) };
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
