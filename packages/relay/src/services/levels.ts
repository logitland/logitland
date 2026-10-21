import { Level, LevelRules, LevelUpdate, levelXp, type LevelLimits, type LevelPermission } from '@logitland/contracts';
import { iso, type Relay } from '../context';
import { conflict, notFound } from '../errors';
import { auditStmt } from './audit';

// Numbered levels (#6). An agent's level comes from its XP on the curve (LEVEL_CURVE), with no cap. The levels stored here are
// the ones that grant something: admins add one on the dashboard when a level should bring limits, permissions or a
// role. They are sparse: an agent at level 7 gets the rules of the highest stored level at or below 7. Level 0 (probation)
// always exists.

interface LevelRow {
  level: number;
  name: string;
  role_id: string | null;
  rules: string;
}

const toLevel = (r: LevelRow): Level => ({ level: r.level, name: r.name, xp: levelXp(r.level), role_id: r.role_id, ...LevelRules.parse(JSON.parse(r.rules)) });

/** Every stored level, lowest first. */
export async function listLevels(relay: Relay): Promise<Level[]> {
  const { results } = await relay.db.prepare('SELECT level, name, role_id, rules FROM levels ORDER BY level').all<LevelRow>();
  return results.map(toLevel);
}

/** What an agent at `level` may do. */
export interface Standing {
  level: Level;
  /** The next level up and the XP it needs. Levels have no cap. */
  next: { level: number; xp: number };
  limits: LevelLimits;
  permissions: LevelPermission[];
}

export function standingIn(levels: Level[], level: number): Standing {
  const own = [...levels].reverse().find((l) => l.level <= level) ?? levels[0]!;
  return { level: own, next: { level: level + 1, xp: levelXp(level + 1) }, limits: own.limits, permissions: own.permissions };
}

export async function standingOf(relay: Relay, agent: { level: number }): Promise<Standing> {
  return standingIn(await listLevels(relay), agent.level);
}

/** The Discord level roles an agent at `level` counts as holding: its own and every lower level's (stacking, #6). */
export const levelRoles = (levels: Level[], level: number): string[] => levels.filter((l) => l.level <= level && l.role_id).map((l) => l.role_id!);

/** Creates or replaces the rules a level grants. Its XP is the curve's. */
export async function putLevel(relay: Relay, adminId: string, level: number, update: LevelUpdate): Promise<Level> {
  const levels = await listLevels(relay);
  const before = levels.find((l) => l.level === level) ?? null;
  assertBetween(
    update,
    levels.findLast((l) => l.level < level),
    levels.find((l) => l.level > level),
  );
  const { name, role_id, ...rules } = update;
  const after = Level.parse({ level, xp: levelXp(level), ...update });
  await relay.db.batch([
    relay.db
      .prepare(
        'INSERT INTO levels (level, name, xp, role_id, rules, updated_at) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT (level) DO UPDATE SET name = excluded.name, xp = excluded.xp, role_id = excluded.role_id, rules = excluded.rules, updated_at = excluded.updated_at',
      )
      .bind(level, name, after.xp, role_id, JSON.stringify(rules), iso(relay.now())),
    auditStmt(relay, {
      actor_type: 'admin',
      actor_id: adminId,
      action: before ? 'level.updated' : 'level.added',
      target_type: 'level',
      target_id: String(level),
      diff: { level: { from: before, to: after } },
    }),
  ]);
  return after;
}

/**
 * A level only adds to what the levels below it grant: no limit lower and no permission missing, and nothing above what the
 * levels above it grant. So climbing never takes anything away.
 */
function assertBetween(update: LevelUpdate, below: Level | undefined, above: Level | undefined): void {
  const said = (key: string) => key.replaceAll('_', ' ');
  for (const key of Object.keys(update.limits) as (keyof LevelLimits)[]) {
    if (below && update.limits[key] < below.limits[key])
      throw conflict(`${said(key)} can’t be lower than Level ${below.level}’s ${below.limits[key]}: higher levels never get less.`);
    if (above && update.limits[key] > above.limits[key])
      throw conflict(`${said(key)} can’t be higher than Level ${above.level}’s ${above.limits[key]}. Raise Level ${above.level} first.`);
  }
  const dropped = below?.permissions.filter((p) => !update.permissions.includes(p)) ?? [];
  if (dropped.length) throw conflict(`Level ${below!.level} already allows ${dropped.map(said).join(', ')}, so every level above it does too.`);
  const early = above ? update.permissions.filter((p) => !above.permissions.includes(p)) : [];
  if (early.length) throw conflict(`Level ${above!.level} doesn’t allow ${early.map(said).join(', ')}. Allow it there first.`);
}

/** Removes a level's rules, above probation. Agents at it keep their level and get the rules of the highest level below. */
export async function deleteLevel(relay: Relay, adminId: string, level: number): Promise<void> {
  if (level === 0) throw conflict('Probation (level 0) can’t be removed.');
  const gone = await relay.db.prepare('DELETE FROM levels WHERE level = ?').bind(level).run();
  if (gone.meta.changes === 0) throw notFound('No such level');
  await auditStmt(relay, { actor_type: 'admin', actor_id: adminId, action: 'level.removed', target_type: 'level', target_id: String(level) }).run();
}
