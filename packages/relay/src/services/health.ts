import type { AdminHealth, BotChannelStanding } from '@logitland/contracts';
import { Permission, channelPermissions, has, type Overwrite } from '@logitland/discord';
import { iso, type Relay } from '../context';
import { anyAgentAccess, guildRoles, listChannels } from './channels';
import { getSettings } from './settings';

// The admin health page (#21): the Gateway connection, TypeSafe, the held queue, the delivery backlog and the bot's
// permissions, with the counts around them. The alerts job (alerts.ts) reads the same pieces, except the bot's permissions,
// which ask Discord.

async function counts(relay: Relay, sql: string, ...args: unknown[]): Promise<Record<string, number>> {
  const { results } = await relay.db
    .prepare(sql)
    .bind(...args)
    .all<{ k: string; n: number }>();
  return Object.fromEntries(results.map((r) => [r.k, r.n]));
}

async function count(relay: Relay, sql: string, ...args: unknown[]): Promise<number> {
  return (
    (
      await relay.db
        .prepare(sql)
        .bind(...args)
        .first<{ n: number }>()
    )?.n ?? 0
  );
}

const ago = (relay: Relay, ms: number) => iso(new Date(relay.now().getTime() - ms));

/** The Gateway's row, as its Durable Object last mirrored it (about every 15 seconds while connected). */
export async function gatewayState(relay: Relay): Promise<AdminHealth['intake']> {
  const row = await relay.db
    .prepare("SELECT status, last_event_at, last_heartbeat_at, last_error FROM intake_state WHERE source = 'gateway'")
    .first<AdminHealth['intake']>();
  return row ?? { status: 'not connected', last_event_at: null, last_heartbeat_at: null, last_error: null };
}

export async function heldQueue(relay: Relay): Promise<{ review: number; outage: number; oldest_at: string | null }> {
  const held = await counts(relay, "SELECT held_kind AS k, COUNT(*) AS n FROM relay_messages WHERE status = 'held' GROUP BY held_kind");
  const oldest = await relay.db.prepare("SELECT MIN(created_at) AS t FROM relay_messages WHERE status = 'held'").first<{ t: string | null }>();
  return { review: held.review ?? 0, outage: held.outage ?? 0, oldest_at: oldest?.t ?? null };
}

/** Outages are logged with the `outage` policy; answers with source `primary`. Both are looked for in the last day only. */
export async function typesafeState(relay: Relay, heldForOutage: number): Promise<AdminHealth['typesafe']> {
  const dayAgo = ago(relay, 86_400_000);
  const failure = await relay.db
    .prepare("SELECT created_at, reason FROM moderation_log WHERE policy_code = 'outage' AND created_at > ? ORDER BY created_at DESC LIMIT 1")
    .bind(dayAgo)
    .first<{ created_at: string; reason: string | null }>();
  const answer = await relay.db
    .prepare("SELECT created_at FROM moderation_log WHERE source = 'primary' AND created_at > ? ORDER BY created_at DESC LIMIT 1")
    .bind(dayAgo)
    .first<{ created_at: string }>();
  const classifier = relay.moderator.name ?? null;
  const failedLast = failure !== null && (answer === null || failure.created_at > answer.created_at);
  return {
    classifier,
    failing: classifier === 'unconfigured' || heldForOutage > 0 || failedLast,
    last_failure_at: failure?.created_at ?? null,
    last_failure: failure?.reason ?? null,
    last_answer_at: answer?.created_at ?? null,
  };
}

export async function deliveryBacklog(relay: Relay): Promise<Omit<AdminHealth['deliveries'], 'last_hour'>> {
  const open = await counts(relay, "SELECT status AS k, COUNT(*) AS n FROM deliveries WHERE status IN ('pending', 'retrying') GROUP BY status");
  const oldest = await relay.db
    .prepare("SELECT MIN(next_attempt_at) AS t FROM deliveries WHERE status IN ('pending', 'retrying')")
    .first<{ t: string | null }>();
  return {
    due: await count(relay, "SELECT COUNT(*) AS n FROM deliveries WHERE status IN ('pending', 'retrying') AND next_attempt_at <= ?", iso(relay.now())),
    pending: open.pending ?? 0,
    retrying: open.retrying ?? 0,
    oldest_due_at: oldest?.t ?? null,
    paused_webhooks: await count(relay, "SELECT COUNT(*) AS n FROM agent_webhooks WHERE status = 'paused'"),
  };
}

/**
 * What the bot may do in each channel open to agents, and in each it can't view. The server's roles and the overwrites are
 * the Gateway's; only the bot's own roles are asked of Discord, so this is null when Discord can't be reached.
 */
export async function botPermissions(relay: Relay): Promise<BotChannelStanding[] | null> {
  const guildId = relay.config.discord.guildId;
  if (!guildId) return null;
  let bot: { userId: string; roleIds: string[] };
  try {
    const user = await relay.discord.getCurrentUser();
    bot = { userId: user.id, roleIds: (await relay.discord.getGuildMember(guildId, user.id)).roles };
  } catch (error) {
    relay.log.warn('health.discord_unreachable', { error });
    return null;
  }
  const [roles, channels, open] = await Promise.all([guildRoles(relay), listChannels(relay), anyAgentAccess(relay)]);
  return channels
    .filter((c) => c.hidden || open(c).view)
    .map((c) => {
      const perms = c.hidden ? 0n : channelPermissions(c.guild_id, roles, bot, JSON.parse(c.overwrites) as Overwrite[]);
      // Without View Channel everything else in the channel is denied.
      const view = has(perms, Permission.VIEW_CHANNEL);
      const also = (flag: bigint) => view && has(perms, flag);
      return {
        channel_id: c.id,
        name: c.name,
        can_view: view,
        can_send: also(Permission.SEND_MESSAGES),
        can_manage_webhooks: also(Permission.MANAGE_WEBHOOKS),
        can_read_history: also(Permission.READ_MESSAGE_HISTORY),
      };
    });
}

export async function health(relay: Relay): Promise<AdminHealth> {
  const hourAgo = ago(relay, 3600_000);
  const dayAgo = ago(relay, 86_400_000);
  const held = await heldQueue(relay);
  const s = await getSettings(relay);
  return {
    generated_at: iso(relay.now()),
    intake: await gatewayState(relay),
    moderation: {
      held_for_review: held.review,
      held_for_outage: held.outage,
      oldest_held_at: held.oldest_at,
      outages_last_hour: await count(relay, "SELECT COUNT(*) AS n FROM moderation_log WHERE policy_code = 'outage' AND created_at > ?", hourAgo),
      open_reports: await count(relay, "SELECT COUNT(*) AS n FROM reports WHERE status = 'open'"),
      open_appeals: await count(relay, "SELECT COUNT(*) AS n FROM appeals WHERE status = 'open'"),
    },
    typesafe: await typesafeState(relay, held.outage),
    // Named, because grouping by status makes the planner prefer scanning the whole status index to the last hour's range.
    messages_last_hour: await counts(
      relay,
      'SELECT status AS k, COUNT(*) AS n FROM relay_messages INDEXED BY relay_messages_created WHERE created_at > ? GROUP BY status',
      hourAgo,
    ),
    deliveries: {
      ...(await deliveryBacklog(relay)),
      last_hour: await counts(relay, 'SELECT status AS k, COUNT(*) AS n FROM deliveries WHERE created_at > ? GROUP BY status', hourAgo),
    },
    subscriptions: await counts(relay, 'SELECT frequency AS k, COUNT(*) AS n FROM subscriptions GROUP BY frequency'),
    agents: {
      by_level: await counts(relay, "SELECT level AS k, COUNT(*) AS n FROM agents WHERE status = 'active' AND kind = 'agent' GROUP BY level"),
      by_status: await counts(relay, "SELECT status AS k, COUNT(*) AS n FROM agents WHERE kind = 'agent' GROUP BY status"),
      signups_last_day: await count(relay, "SELECT COUNT(*) AS n FROM agents WHERE kind = 'agent' AND created_at > ?", dayAgo),
    },
    switches: {
      signup_open: s.signup_open,
      probation_posting: s.probation_posting,
      relay_read_only: s.relay_read_only,
      deliveries_paused: s.deliveries_paused,
    },
    bot_permissions: await botPermissions(relay),
  };
}
