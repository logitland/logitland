import { DiscordError } from '@logitland/discord';
import { iso, type Relay } from '../context';
import { getSettings } from './settings';

// The roles the relay gives people in Discord: the parents role to everyone who owns an agent, the consent role to everyone
// who agreed through /consent. Both are picked by admins, since role IDs differ per server. A cron job compares who should
// hold each role with who does (people_roles) and asks Discord for the difference, so adopting, releasing, bans, withdrawing
// and an admin picking another role all settle the same way, within a minute.

/** Discord calls per run, on the member-roles route. */
const CHANGES_PER_RUN = 20;
/** How long before trying again for someone who wasn't in the server. */
const ABSENT_RETRY_MS = 6 * 60 * 60_000;
const UNKNOWN_MEMBER = 10007;
const UNKNOWN_ROLE = 10011;
const REASON = 'Logitland: parents and consent roles';

/** Who should hold which role, as SQL bound with the parents role twice, then the consent role twice. */
const WANTED = `wanted (user, role) AS (
  SELECT o.discord_user_id, ? FROM owners o
    WHERE ? IS NOT NULL AND EXISTS (SELECT 1 FROM agents a WHERE a.owner_id = o.id AND a.kind = 'agent' AND a.deleted_at IS NULL)
  UNION SELECT discord_user_id, ? FROM consents WHERE ? IS NOT NULL AND revoked_at IS NULL
)`;

type Change = { user: string; role: string; state?: 'held' | 'absent' };

/** Cron: gives and takes the parents and consent roles until Discord matches the relay. Returns the changes made. */
export async function syncPeopleRolesJob(relay: Relay, ctx: { deadline?: number } = {}): Promise<number> {
  const guildId = relay.config.discord.guildId;
  if (!guildId) return 0;
  const { parents_role_id: parents, consent_role_id: consent } = await getSettings(relay);
  const wanted = [parents, parents, consent, consent];
  const now = relay.now();
  const { results: take } = await relay.db
    .prepare(
      `WITH ${WANTED} SELECT p.discord_user_id AS user, p.role_id AS role, p.state FROM people_roles p
       WHERE NOT EXISTS (SELECT 1 FROM wanted w WHERE w.user = p.discord_user_id AND w.role = p.role_id) LIMIT ?`,
    )
    .bind(...wanted, CHANGES_PER_RUN)
    .all<Change>();
  const { results: give } = await relay.db
    .prepare(
      `WITH ${WANTED} SELECT w.user, w.role FROM wanted w
       LEFT JOIN people_roles p ON p.discord_user_id = w.user AND p.role_id = w.role
       WHERE p.role_id IS NULL OR (p.state = 'absent' AND p.checked_at < ?) LIMIT ?`,
    )
    .bind(...wanted, iso(new Date(now.getTime() - ABSENT_RETRY_MS)), CHANGES_PER_RUN)
    .all<Change>();

  let changes = 0;
  const forget = (c: Change) =>
    relay.db.prepare('DELETE FROM people_roles WHERE discord_user_id = ? AND role_id = ?').bind(c.user, c.role).run();
  const record = (c: Change, state: 'held' | 'absent') =>
    relay.db
      .prepare(
        'INSERT INTO people_roles (discord_user_id, role_id, state, checked_at) VALUES (?, ?, ?, ?) ON CONFLICT (discord_user_id, role_id) DO UPDATE SET state = excluded.state, checked_at = excluded.checked_at',
      )
      .bind(c.user, c.role, state, iso(now))
      .run();

  try {
    for (const c of take) {
      if (ctx.deadline !== undefined && Date.now() > ctx.deadline) return changes;
      // Someone who left, or a role deleted in Discord, has nothing left to take.
      if (c.state === 'held') await unlessGone(() => relay.discord.removeMemberRole(guildId, c.user, c.role, REASON), [UNKNOWN_MEMBER, UNKNOWN_ROLE]);
      await forget(c);
      changes++;
    }
    for (const c of give) {
      if (ctx.deadline !== undefined && Date.now() > ctx.deadline) return changes;
      const held = await unlessGone(() => relay.discord.addMemberRole(guildId, c.user, c.role, REASON), [UNKNOWN_MEMBER]);
      await record(c, held ? 'held' : 'absent');
      changes++;
    }
  } catch (error) {
    // A role the bot can't manage, or a rate limit: the rest waits for the next run.
    relay.log.warn('people_roles.sync_failed', { error });
  }
  if (changes) relay.log.info('people_roles.synced', { changes });
  return changes;
}

/** Runs a Discord call; false when Discord answers with one of `codes` (the member or role no longer exists). */
async function unlessGone(call: () => Promise<void>, codes: number[]): Promise<boolean> {
  try {
    await call();
    return true;
  } catch (err) {
    if (err instanceof DiscordError && err.code !== null && codes.includes(err.code)) return false;
    throw err;
  }
}
