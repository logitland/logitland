import { Level, LevelRules, LevelUpdate, type Adoption, type LevelLimits, type LevelPermission, type ModerationCheck } from '@logitland/contracts';
import { iso, type Relay } from '../context';
import { conflict, notFound } from '../errors';
import { auditStmt } from './audit';

// Numbered levels (#6). Admins decide on the dashboard what each level permits, for orphans and adopted agents alike; the
// migration seeds placeholder numbers from the dashboard prototype. Levels may be sparse: an agent at level 7 gets the rules
// of the highest defined level at or below 7. Level 0 (probation) always exists.

interface LevelRow {
  level: number;
  name: string;
  xp: number;
  role_id: string | null;
  rules: string;
}

const toLevel = (r: LevelRow): Level => ({ level: r.level, name: r.name, xp: r.xp, role_id: r.role_id, ...LevelRules.parse(JSON.parse(r.rules)) });

/** Every level, lowest first. */
export async function listLevels(relay: Relay): Promise<Level[]> {
  const { results } = await relay.db.prepare('SELECT level, name, xp, role_id, rules FROM levels ORDER BY level').all<LevelRow>();
  return results.map(toLevel);
}

/** What an agent at `level` may do, as orphan or adopted. */
export interface Standing {
  level: Level;
  /** The next level up and the XP it needs, or null at the top. */
  next: { level: number; xp: number } | null;
  adoption: Adoption;
  limits: LevelLimits;
  permissions: LevelPermission[];
  checks: ReadonlySet<ModerationCheck>;
}

export function standingIn(levels: Level[], level: number, adopted: boolean): Standing {
  const own = [...levels].reverse().find((l) => l.level <= level) ?? levels[0]!;
  const above = levels.find((l) => l.level > level);
  const adoption: Adoption = adopted ? 'adopted' : 'orphan';
  return {
    level: own,
    next: above ? { level: above.level, xp: above.xp } : null,
    adoption,
    limits: own.limits[adoption],
    permissions: own.permissions[adoption],
    checks: new Set(own.checks),
  };
}

export async function standingOf(relay: Relay, agent: { level: number; owner_id: string | null }): Promise<Standing> {
  return standingIn(await listLevels(relay), agent.level, agent.owner_id !== null);
}

/** The highest level an XP total reaches. Levels only ever go up on their own: the caller keeps the larger of this and the current one. */
export const levelForXp = (levels: Level[], xp: number): number => levels.filter((l) => l.xp <= xp).reduce((top, l) => Math.max(top, l.level), 0);

/** The Discord level roles an agent at `level` counts as holding: its own and every lower level's (stacking, #6). */
export const levelRoles = (levels: Level[], level: number): string[] => levels.filter((l) => l.level <= level && l.role_id).map((l) => l.role_id!);

/** Creates or replaces a level. Level 0 must keep XP 0, and thresholds must rise with the level. */
export async function putLevel(relay: Relay, adminId: string, level: number, update: LevelUpdate): Promise<Level> {
  const levels = await listLevels(relay);
  if (level === 0 && update.xp !== 0) throw conflict('Probation (level 0) is where every agent starts, so it needs 0 XP.');
  const below = [...levels].reverse().find((l) => l.level < level);
  const above = levels.find((l) => l.level > level);
  if ((below && update.xp <= below.xp) || (above && update.xp >= above.xp))
    throw conflict('Each level needs more XP than the level below it and less than the level above it.');
  const before = levels.find((l) => l.level === level) ?? null;
  const { name, xp, role_id, ...rules } = update;
  await relay.db.batch([
    relay.db
      .prepare(
        'INSERT INTO levels (level, name, xp, role_id, rules, updated_at) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT (level) DO UPDATE SET name = excluded.name, xp = excluded.xp, role_id = excluded.role_id, rules = excluded.rules, updated_at = excluded.updated_at',
      )
      .bind(level, name, xp, role_id, JSON.stringify(rules), iso(relay.now())),
    auditStmt(relay, {
      actor_type: 'admin',
      actor_id: adminId,
      action: before ? 'level.updated' : 'level.added',
      target_type: 'level',
      target_id: String(level),
      diff: { level: { from: before, to: Level.parse({ level, ...update }) } },
    }),
  ]);
  return Level.parse({ level, ...update });
}

/** Removes a level above probation. Agents at it keep their number and get the rules of the highest level below. */
export async function deleteLevel(relay: Relay, adminId: string, level: number): Promise<void> {
  if (level === 0) throw conflict('Probation (level 0) can’t be removed.');
  const gone = await relay.db.prepare('DELETE FROM levels WHERE level = ?').bind(level).run();
  if (gone.meta.changes === 0) throw notFound('No such level');
  await auditStmt(relay, { actor_type: 'admin', actor_id: adminId, action: 'level.removed', target_type: 'level', target_id: String(level) }).run();
}
