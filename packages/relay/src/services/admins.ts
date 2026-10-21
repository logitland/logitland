import { AdminPermission, type AdminRole, type AdminRoleUpdate, type AdminStanding } from '@logitland/contracts';
import { DiscordError, TEAM_MEMBER_ACCEPTED } from '@logitland/discord';
import { iso, type Relay } from '../context';
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

/** Discord's answer under `key`, asked again once it is older than `ttlMs`. */
async function lookup(relay: Relay, key: string, ttlMs: number, ask: () => Promise<string[]>): Promise<string[]> {
  const row = await relay.db.prepare('SELECT value, fetched_at FROM discord_lookups WHERE key = ?').bind(key).first<{ value: string; fetched_at: string }>();
  const now = relay.now();
  if (row && now.getTime() - Date.parse(row.fetched_at) < ttlMs) return JSON.parse(row.value) as string[];
  let value: string[];
  try {
    value = await ask();
  } catch (error) {
    relay.log.warn('admins.discord_unreachable', { key, stale: Boolean(row), error });
    if (row) return JSON.parse(row.value) as string[];
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
export const fullAdmins = (relay: Relay): Promise<string[]> =>
  lookup(relay, 'team', TEAM_TTL_MS, async () => {
    const app = await relay.discord.getCurrentApplication();
    if (app.team) {
      const accepted = app.team.members.filter((m) => m.membership_state === TEAM_MEMBER_ACCEPTED).map((m) => m.user.id);
      return [...new Set([app.team.owner_user_id, ...accepted])];
    }
    if (app.owner) return [app.owner.id];
    throw new Error('Discord named no owner for the application');
  });

/** A person's roles in the server. Someone who isn't in it holds none. */
const memberRoles = (relay: Relay, guildId: string, discordUserId: string): Promise<string[]> =>
  lookup(relay, `member:${discordUserId}`, MEMBER_TTL_MS, async () => {
    try {
      return (await relay.discord.getGuildMember(guildId, discordUserId)).roles;
    } catch (err) {
      if (err instanceof DiscordError && err.status === 404) return [];
      throw err;
    }
  });

/** Permissions in AdminPermission's order, each once. */
const ordered = (held: Iterable<AdminPermission>): AdminPermission[] => {
  const set = new Set(held);
  return AdminPermission.options.filter((p) => set.has(p));
};

/** Whether this person is an admin and what they may do. Discord is only asked about their roles once a role is mapped. */
export async function adminStanding(relay: Relay, discordUserId: string): Promise<AdminStanding> {
  if ((await fullAdmins(relay)).includes(discordUserId)) return { full: true, permissions: [...AdminPermission.options] };
  const guildId = relay.config.discord.guildId;
  const { results: mapped } = await relay.db.prepare('SELECT role_id, permissions FROM admin_roles').all<{ role_id: string; permissions: string }>();
  if (!guildId || !mapped.length) return NO_STANDING;
  const roles = new Set(await memberRoles(relay, guildId, discordUserId));
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
