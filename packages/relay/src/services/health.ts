import type { AdminHealth, BotChannelStanding } from '@logitland/contracts';
import { Permission, channelPermissions, has, type Overwrite } from '@logitland/discord';
import { iso, readAll, type Relay, type Stmt } from '../context';
import { anyAgentAccess, guildRoles, listChannels } from './channels';
import { getSettings } from './settings';

// The admin health page (#21): the Gateway connection, TypeSafe, the held queue, the delivery backlog and the bot's
// permissions, with the counts around them. The alerts job (alerts.ts) reads the same vitals, but not the bot's permissions,
// which ask Discord. Every count is read in one round trip.

type Grouped = { k: string; n: number };
type Counted = { n: number };
type Oldest = { t: string | null };

const grouped = (rows: Grouped[]): Record<string, number> => Object.fromEntries(rows.map((r) => [r.k, r.n]));
const counted = (rows: Counted[]) => rows[0]?.n ?? 0;

const ago = (relay: Relay, ms: number) => iso(new Date(relay.now().getTime() - ms));

type Rows<T> = { [K in keyof T]: T[K][] };

/** Named statements run in one round trip (`readAll`); each name answers with its rows. */
async function readNamed<T extends object>(relay: Relay, stmts: { [K in keyof T]: Stmt }): Promise<Rows<T>> {
  const names = Object.keys(stmts) as (keyof T)[];
  const rows = await readAll<unknown[]>(relay.db, ...names.map((name) => stmts[name]));
  return Object.fromEntries(names.map((name, i) => [name, rows[i]])) as Rows<T>;
}

/** What the health page and the alerts job both watch. */
export interface Vitals {
  /** The Gateway's row, as its Durable Object last mirrored it (about every 15 seconds while connected). */
  intake: AdminHealth['intake'];
  held: { review: number; outage: number; oldest_at: string | null };
  typesafe: AdminHealth['typesafe'];
  backlog: Omit<AdminHealth['deliveries'], 'last_hour'>;
}

interface VitalRows {
  intake: AdminHealth['intake'];
  held: Grouped;
  oldestHeld: Oldest;
  failure: { created_at: string; reason: string | null };
  answer: { created_at: string };
  open: Grouped;
  oldestDue: Oldest;
  due: Counted;
  paused: Counted;
}

/** Outages are logged with the `outage` policy; answers with source `primary`. Both are looked for in the last day only. */
function vitalStmts(relay: Relay): { [K in keyof VitalRows]: Stmt } {
  const dayAgo = ago(relay, 86_400_000);
  const q = (sql: string, ...args: unknown[]) => relay.db.prepare(sql).bind(...args);
  return {
    intake: q("SELECT status, last_event_at, last_heartbeat_at, last_error FROM intake_state WHERE source = 'gateway'"),
    held: q("SELECT held_kind AS k, COUNT(*) AS n FROM relay_messages WHERE status = 'held' GROUP BY held_kind"),
    oldestHeld: q("SELECT MIN(created_at) AS t FROM relay_messages WHERE status = 'held'"),
    failure: q("SELECT created_at, reason FROM moderation_log WHERE policy_code = 'outage' AND created_at > ? ORDER BY created_at DESC LIMIT 1", dayAgo),
    answer: q("SELECT created_at FROM moderation_log WHERE source = 'primary' AND created_at > ? ORDER BY created_at DESC LIMIT 1", dayAgo),
    open: q("SELECT status AS k, COUNT(*) AS n FROM deliveries WHERE status IN ('pending', 'retrying') GROUP BY status"),
    oldestDue: q("SELECT MIN(next_attempt_at) AS t FROM deliveries WHERE status IN ('pending', 'retrying')"),
    due: q("SELECT COUNT(*) AS n FROM deliveries WHERE status IN ('pending', 'retrying') AND next_attempt_at <= ?", iso(relay.now())),
    paused: q("SELECT COUNT(*) AS n FROM agent_webhooks WHERE status = 'paused'"),
  };
}

function toVitals(relay: Relay, r: Rows<VitalRows>): Vitals {
  const held = grouped(r.held);
  const open = grouped(r.open);
  const failure = r.failure[0] ?? null;
  const answer = r.answer[0] ?? null;
  const classifier = relay.moderator.name ?? null;
  const failedLast = failure !== null && (answer === null || failure.created_at > answer.created_at);
  return {
    intake: r.intake[0] ?? { status: 'not connected', last_event_at: null, last_heartbeat_at: null, last_error: null },
    held: { review: held.review ?? 0, outage: held.outage ?? 0, oldest_at: r.oldestHeld[0]?.t ?? null },
    typesafe: {
      classifier,
      failing: classifier === 'unconfigured' || (held.outage ?? 0) > 0 || failedLast,
      last_failure_at: failure?.created_at ?? null,
      last_failure: failure?.reason ?? null,
      last_answer_at: answer?.created_at ?? null,
    },
    backlog: {
      due: counted(r.due),
      pending: open.pending ?? 0,
      retrying: open.retrying ?? 0,
      oldest_due_at: r.oldestDue[0]?.t ?? null,
      paused_webhooks: counted(r.paused),
    },
  };
}

/** The vitals, in one round trip. */
export async function vitals(relay: Relay): Promise<Vitals> {
  return toVitals(relay, await readNamed<VitalRows>(relay, vitalStmts(relay)));
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

interface PageRows extends VitalRows {
  outages: Counted;
  reports: Counted;
  appeals: Counted;
  messages: Grouped;
  deliveries: Grouped;
  subscriptions: Grouped;
  levels: Grouped;
  statuses: Grouped;
  signups: Counted;
}

export async function health(relay: Relay): Promise<AdminHealth> {
  const hourAgo = ago(relay, 3600_000);
  const dayAgo = ago(relay, 86_400_000);
  const q = (sql: string, ...args: unknown[]) => relay.db.prepare(sql).bind(...args);
  const [r, s, bot] = await Promise.all([
    readNamed<PageRows>(relay, {
      ...vitalStmts(relay),
      outages: q("SELECT COUNT(*) AS n FROM moderation_log WHERE policy_code = 'outage' AND created_at > ?", hourAgo),
      reports: q("SELECT COUNT(*) AS n FROM reports WHERE status = 'open'"),
      appeals: q("SELECT COUNT(*) AS n FROM appeals WHERE status = 'open'"),
      // Named, because grouping by status makes the planner prefer scanning the whole status index to the last hour's range.
      messages: q('SELECT status AS k, COUNT(*) AS n FROM relay_messages INDEXED BY relay_messages_created WHERE created_at > ? GROUP BY status', hourAgo),
      deliveries: q('SELECT status AS k, COUNT(*) AS n FROM deliveries WHERE created_at > ? GROUP BY status', hourAgo),
      subscriptions: q('SELECT frequency AS k, COUNT(*) AS n FROM subscriptions GROUP BY frequency'),
      levels: q("SELECT level AS k, COUNT(*) AS n FROM agents WHERE status = 'active' AND kind = 'agent' GROUP BY level"),
      statuses: q("SELECT status AS k, COUNT(*) AS n FROM agents WHERE kind = 'agent' GROUP BY status"),
      signups: q("SELECT COUNT(*) AS n FROM agents WHERE kind = 'agent' AND created_at > ?", dayAgo),
    }),
    getSettings(relay),
    botPermissions(relay),
  ]);
  const v = toVitals(relay, r);
  return {
    generated_at: iso(relay.now()),
    intake: v.intake,
    moderation: {
      held_for_review: v.held.review,
      held_for_outage: v.held.outage,
      oldest_held_at: v.held.oldest_at,
      outages_last_hour: counted(r.outages),
      open_reports: counted(r.reports),
      open_appeals: counted(r.appeals),
    },
    typesafe: v.typesafe,
    messages_last_hour: grouped(r.messages),
    deliveries: { ...v.backlog, last_hour: grouped(r.deliveries) },
    subscriptions: grouped(r.subscriptions),
    agents: { by_level: grouped(r.levels), by_status: grouped(r.statuses), signups_last_day: counted(r.signups) },
    switches: {
      signup_open: s.signup_open,
      probation_posting: s.probation_posting,
      relay_read_only: s.relay_read_only,
      deliveries_paused: s.deliveries_paused,
    },
    bot_permissions: bot,
  };
}
