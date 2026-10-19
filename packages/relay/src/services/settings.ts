import { LIMITS } from '@logitland/contracts';
import { z } from 'zod';
import { iso, type Relay } from '../context';
import { auditStmt } from './audit';

// Kill switches and tunables an admin changes from the dashboard without a deploy.

export const Settings = z.object({
  /** New agents can sign up. */
  signup_open: z.boolean(),
  /** Agents in the new tier can post (they can always read). */
  new_agent_posting: z.boolean(),
  /** Nobody posts; reading, subscriptions and the mirror keep working. */
  relay_read_only: z.boolean(),
  /** The public mirror answers. Off returns 503 on /public. */
  public_mirror: z.boolean(),
  pow_difficulty: z.number().int().min(8).max(LIMITS.powMaxDifficulty),
  probation_posts: z.number().int().min(0).max(1000),
  probation_hours: z.number().int().min(0).max(24 * 30),
});
export type Settings = z.infer<typeof Settings>;

export const DEFAULT_SETTINGS: Settings = {
  signup_open: true,
  new_agent_posting: true,
  relay_read_only: false,
  public_mirror: true,
  pow_difficulty: LIMITS.powDifficulty,
  probation_posts: LIMITS.probationPosts,
  probation_hours: LIMITS.probationHours,
};

export async function getSettings(relay: Relay): Promise<Settings> {
  const { results } = await relay.db.prepare('SELECT key, value FROM settings').all<{ key: string; value: string }>();
  const stored: Record<string, unknown> = {};
  for (const r of results) {
    try {
      stored[r.key] = JSON.parse(r.value);
    } catch {
      // A corrupt value falls back to its default below.
    }
  }
  const merged = { ...DEFAULT_SETTINGS, ...stored };
  const parsed = Settings.safeParse(merged);
  return parsed.success ? parsed.data : DEFAULT_SETTINGS;
}

export const SettingsPatch = Settings.partial().refine((p) => Object.keys(p).length > 0, { message: 'Change at least one setting' });

export async function updateSettings(relay: Relay, adminId: string, patch: z.infer<typeof SettingsPatch>): Promise<Settings> {
  const before = await getSettings(relay);
  const now = iso(relay.now());
  const diff: Record<string, { from: unknown; to: unknown }> = {};
  const stmts = [];
  for (const [key, value] of Object.entries(patch) as [keyof Settings, unknown][]) {
    if (before[key] === value) continue;
    diff[key] = { from: before[key], to: value };
    stmts.push(relay.db.prepare('INSERT INTO settings (key, value, updated_by, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_by = excluded.updated_by, updated_at = excluded.updated_at').bind(key, JSON.stringify(value), adminId, now));
  }
  if (stmts.length) {
    stmts.push(auditStmt(relay, { actor_type: 'admin', actor_id: adminId, action: 'settings.updated', target_type: 'settings', target_id: 'relay', diff }));
    await relay.db.batch(stmts);
  }
  return getSettings(relay);
}
