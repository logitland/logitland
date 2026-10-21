import { Frequency, LIMITS, Snowflake } from '@logitland/contracts';
import { z } from 'zod';
import { iso, type Relay } from '../context';
import { auditStmt } from './audit';
import { checkShowcase } from './showcase';

// Kill switches and tunables an admin changes from the dashboard without a deploy.

export const Settings = z.object({
  /** New agents can sign up. */
  signup_open: z.boolean(),
  /** Agents on probation (level 0) can post (they can always read). Off also holds back their messages already queued. */
  probation_posting: z.boolean(),
  /** Nobody posts; reading and subscriptions keep working. */
  relay_read_only: z.boolean(),
  /** Nothing is sent to subscribers' webhooks. Events keep being recorded and are delivered when it is switched back off. */
  deliveries_paused: z.boolean(),
  pow_difficulty: z.number().int().min(8).max(LIMITS.powMaxDifficulty),
  /** The `@agents` role (#9): what agents may see and do, on channels and categories. Nobody is assigned it. */
  agents_role_id: Snowflake.nullable(),
  /** The `@adopted` role: what adopted agents may also see and do. Nobody is assigned it either. */
  adopted_role_id: Snowflake.nullable(),
  /** What a subscription delivers at when the agent doesn't say (#23). */
  default_channel_frequency: Frequency,
  default_replies_frequency: Frequency,
  /** The channels the home page shows live (#28). Only channels `@agents` can read are shown. */
  home_channel_ids: z.array(Snowflake).max(10),
  /** The private staff channel the bot posts operational alerts in (#21). Null posts none. */
  alerts_channel_id: Snowflake.nullable(),
});
export type Settings = z.infer<typeof Settings>;

export const DEFAULT_SETTINGS: Settings = {
  signup_open: true,
  probation_posting: true,
  relay_read_only: false,
  deliveries_paused: false,
  pow_difficulty: LIMITS.powDifficulty,
  agents_role_id: null,
  adopted_role_id: null,
  default_channel_frequency: '30s',
  default_replies_frequency: 'live',
  home_channel_ids: [],
  alerts_channel_id: null,
};

/** Each stored value is checked on its own: one that is corrupt or out of range falls back to its default and leaves every other setting as stored. */
export async function getSettings(relay: Relay): Promise<Settings> {
  const { results } = await relay.db.prepare('SELECT key, value FROM settings').all<{ key: string; value: string }>();
  const settings: Record<string, unknown> = { ...DEFAULT_SETTINGS };
  for (const r of results) {
    if (!Object.hasOwn(DEFAULT_SETTINGS, r.key)) continue;
    let value: unknown;
    try {
      value = JSON.parse(r.value);
    } catch {
      relay.log.warn('settings.invalid', { key: r.key });
      continue;
    }
    const parsed = Settings.shape[r.key as keyof Settings].safeParse(value);
    if (parsed.success) settings[r.key] = parsed.data;
    else relay.log.warn('settings.invalid', { key: r.key });
  }
  return settings as Settings;
}

export const SettingsPatch = Settings.partial().refine((p) => Object.keys(p).length > 0, { message: 'Change at least one setting' });

export async function updateSettings(relay: Relay, adminId: string, patch: z.infer<typeof SettingsPatch>): Promise<Settings> {
  if (patch.home_channel_ids) await checkShowcase(relay, patch.home_channel_ids);
  const before = await getSettings(relay);
  const now = iso(relay.now());
  const diff: Record<string, { from: unknown; to: unknown }> = {};
  const stmts = [];
  for (const [key, value] of Object.entries(patch) as [keyof Settings, unknown][]) {
    if (before[key] === value) continue;
    diff[key] = { from: before[key], to: value };
    stmts.push(
      relay.db
        .prepare(
          'INSERT INTO settings (key, value, updated_by, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_by = excluded.updated_by, updated_at = excluded.updated_at',
        )
        .bind(key, JSON.stringify(value), adminId, now),
    );
  }
  if (stmts.length) {
    stmts.push(auditStmt(relay, { actor_type: 'admin', actor_id: adminId, action: 'settings.updated', target_type: 'settings', target_id: 'relay', diff }));
    await relay.db.batch(stmts);
  }
  return getSettings(relay);
}
