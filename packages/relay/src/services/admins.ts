import { AdminPermission, type AdminRole, type AdminRoleUpdate, type AdminStanding, type TeamMember } from '@logitland/contracts';
import { DiscordError, TEAM_MEMBER_ACCEPTED } from '@logitland/discord';
import { iso, readAll, type Relay } from '../context';
import { RelayError, invalid, notFound, unavailable } from '../errors';
import { auditStmt } from './audit';

// Human admins (#13). Full admins are the Discord Developer team that owns the bot, read from the application; narrower
// powers come from server roles that full admins map to admin permissions. Discord's answers are cached in discord_lookups
// for a few minutes, read when someone asks, and the last answer stands in while Discord can't be reached.

/** Joining or leaving the Developer team takes effect within this long. */
const TEAM_TTL_MS = 10 * 60_000;
/** A role given or taken in the server changes admin powers within this long. */
const MEMBER_TTL_MS = 60_000;
/** Members' cached roles are deleted after this long, so people who stop signing in leave nothing behind. */
const MEMBER_KEEP_MS = 86_400_000;

const NO_STANDING: AdminStanding = { full: false, permissions: [] };

type Cached = { value: string; fetched_at: string };

const cachedStmt = (relay: Relay, key: string) => relay.db.prepare('SELECT value, fetched_at FROM discord_lookups WHERE key = ?').bind(key);

/** Discord's answer under `key`, asked again once it is older than `ttlMs`. */
export async function lookup<T>(relay: Relay, key: string, ttlMs: number, ask: () => Promise<T>): Promise<T> {
  return answer(relay, key, ttlMs, ask, await cachedStmt(relay, key).first<Cached>());
}

/** `lookup`, given what is cached under `key` already read (null when nothing is). */
async function answer<T>(relay: Relay, key: string, ttlMs: number, ask: () => Promise<T>, row: Cached | null): Promise<T> {
  const now = relay.now();
  if (row && now.getTime() - Date.parse(row.fetched_at) < ttlMs) return JSON.parse(row.value) as T;
  let value: T;
  try {
    value = await ask();
  } catch (error) {
    relay.log.warn('admins.discord_unreachable', { key, stale: Boolean(row), error });
    if (row) return JSON.parse(row.value) as T;
    // A wrong token is what a new deployment most likely gets wrong, and with it nobody can open the setup checklist.
    if (error instanceof DiscordError && error.status === 401)
      throw new RelayError(503, 'misconfigured', 'Discord rejected the bot token, so admin standing can’t be checked. Check DISCORD_BOT_TOKEN.');
    throw unavailable('Discord can’t be reached to check admin standing. Try again in a minute.', 60);
  }
  await relay.db
    .prepare(
      'INSERT INTO discord_lookups (key, value, fetched_at) VALUES (?, ?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value, fetched_at = excluded.fetched_at',
    )
    .bind(key, JSON.stringify(value), iso(now))
    .run();
  return value;
}

/** The Discord user IDs of the full admins: the team that owns the bot (its owner and accepted members), or its one owner. */
export const fullAdmins = (relay: Relay): Promise<string[]> => lookup(relay, 'team', TEAM_TTL_MS, () => askTeam(relay));

async function askTeam(relay: Relay): Promise<string[]> {
  const app = await relay.discord.getCurrentApplication();
  if (app.team) {
    const accepted = app.team.members.filter((m) => m.membership_state === TEAM_MEMBER_ACCEPTED).map((m) => m.user.id);
    return [...new Set([app.team.owner_user_id, ...accepted])];
  }
  if (app.owner) return [app.owner.id];
  throw new Error('Discord named no owner for the application');
}

type TeamUser = { id: string; username: string; global_name?: string | null };

/**
 * The full admins with their names, for the admin pages: the accepted members of the Developer team (or the application's
 * one owner), and their owner IDs once they have signed in. Cached apart from `fullAdmins`, which only needs IDs.
 */
export async function developerTeam(relay: Relay): Promise<TeamMember[]> {
  const users = await lookup<TeamUser[]>(relay, 'team-members', TEAM_TTL_MS, async () => {
    const app = await relay.discord.getCurrentApplication();
    const people = app.team ? app.team.members.filter((m) => m.membership_state === TEAM_MEMBER_ACCEPTED).map((m) => m.user) : app.owner ? [app.owner] : [];
    return people.map(({ id, username, global_name }) => ({ id, username, global_name }));
  });
  if (!users.length) return [];
  const { results: owners } = await relay.db
    .prepare(`SELECT id, discord_user_id FROM owners WHERE discord_user_id IN (${users.map(() => '?').join(', ')})`)
    .bind(...users.map((u) => u.id))
    .all<{ id: string; discord_user_id: string }>();
  return users.map((u) => ({
    discord_user_id: u.id,
    username: u.username,
    name: u.global_name || u.username,
    owner_id: owners.find((o) => o.discord_user_id === u.id)?.id ?? null,
  }));
}

/** A person's roles in the server. Someone who isn't in it holds none. */
async function askMemberRoles(relay: Relay, guildId: string, discordUserId: string): Promise<string[]> {
  try {
    return (await relay.discord.getGuildMember(guildId, discordUserId)).roles;
  } catch (err) {
    if (err instanceof DiscordError && err.status === 404) return [];
    throw err;
  }
}

/** Permissions in AdminPermission's order, each once. */
const ordered = (held: Iterable<AdminPermission>): AdminPermission[] => {
  const set = new Set(held);
  return AdminPermission.options.filter((p) => set.has(p));
};

/**
 * Whether this person is an admin and what they may do. Discord is only asked about their roles once a role is mapped, and
 * not at all when the caller passes the roles it just fetched (`fresh`), as the Logan admin MCP does on every call. What is
 * cached is read in one round trip.
 */
export async function adminStanding(relay: Relay, discordUserId: string, fresh?: string[]): Promise<AdminStanding> {
  const memberKey = `member:${discordUserId}`;
  const [team, mapped, member] = await readAll<[Cached, { role_id: string; permissions: string }, Cached]>(
    relay.db,
    cachedStmt(relay, 'team'),
    relay.db.prepare('SELECT role_id, permissions FROM admin_roles'),
    cachedStmt(relay, memberKey),
  );
  if ((await answer(relay, 'team', TEAM_TTL_MS, () => askTeam(relay), team[0] ?? null)).includes(discordUserId))
    return { full: true, permissions: [...AdminPermission.options] };
  const guildId = relay.config.discord.guildId;
  if (!guildId || !mapped.length) return NO_STANDING;
  const roles = new Set(fresh ?? (await answer(relay, memberKey, MEMBER_TTL_MS, () => askMemberRoles(relay, guildId, discordUserId), member[0] ?? null)));
  return { full: false, permissions: ordered(mapped.filter((m) => roles.has(m.role_id)).flatMap((m) => JSON.parse(m.permissions) as AdminPermission[])) };
}

/** The server's roles (from the Gateway, without @everyone), highest first, with the admin permissions each grants. */
export async function listAdminRoles(relay: Relay): Promise<AdminRole[]> {
  const { results } = await relay.db
    .prepare(
      'SELECT r.id, r.name, a.permissions FROM guild_roles r LEFT JOIN admin_roles a ON a.role_id = r.id WHERE r.id != r.guild_id ORDER BY r.position DESC, r.id',
    )
    .all<{ id: string; name: string; permissions: string | null }>();
  return results.map((r) => ({ id: r.id, name: r.name, permissions: r.permissions ? (JSON.parse(r.permissions) as AdminPermission[]) : [] }));
}

/** Sets what a server role lets its members do on the admin pages; an empty list takes it away. Audited. */
export async function setAdminRole(relay: Relay, adminId: string, roleId: string, update: AdminRoleUpdate): Promise<AdminRole> {
  const role = await relay.db
    .prepare('SELECT id, guild_id, name FROM guild_roles WHERE id = ?')
    .bind(roleId)
    .first<{ id: string; guild_id: string; name: string }>();
  if (!role) throw notFound('No such role in the server');
  if (role.id === role.guild_id) throw invalid('@everyone can’t grant admin powers: everyone in the server would hold them.');
  const before = await relay.db.prepare('SELECT permissions FROM admin_roles WHERE role_id = ?').bind(roleId).first<{ permissions: string }>();
  const permissions = ordered(update.permissions);
  await relay.db.batch([
    permissions.length
      ? relay.db
          .prepare(
            'INSERT INTO admin_roles (role_id, permissions, updated_at) VALUES (?, ?, ?) ON CONFLICT (role_id) DO UPDATE SET permissions = excluded.permissions, updated_at = excluded.updated_at',
          )
          .bind(roleId, JSON.stringify(permissions), iso(relay.now()))
      : relay.db.prepare('DELETE FROM admin_roles WHERE role_id = ?').bind(roleId),
    auditStmt(relay, {
      actor_type: 'admin',
      actor_id: adminId,
      action: 'admin_role.updated',
      target_type: 'role',
      target_id: roleId,
      diff: { permissions: { from: before ? JSON.parse(before.permissions) : [], to: permissions } },
    }),
  ]);
  return { id: role.id, name: role.name, permissions };
}

/** Cron: forgets members' roles nobody has needed for a day. */
export async function pruneLookupsJob(relay: Relay): Promise<number> {
  const cutoff = iso(new Date(relay.now().getTime() - MEMBER_KEEP_MS));
  return (await relay.db.prepare("DELETE FROM discord_lookups WHERE key LIKE 'member:%' AND fetched_at < ?").bind(cutoff).run()).meta.changes;
}
