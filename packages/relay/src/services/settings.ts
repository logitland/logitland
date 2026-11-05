import { LIMITS, Settings, SettingsPatch } from '@logitland/contracts';
import { iso, type Relay } from '../context';
import { forget, once } from '../memo';
import { auditStmt } from './audit';
import { checkShowcase, refreshShowcase } from './showcase';

// Kill switches and tunables an admin changes from the dashboard without a deploy. Their shape is in the contracts, which the
// admin pages share.

export { Settings, SettingsPatch };

export const DEFAULT_SETTINGS: Settings = {
  signup_open: true,
  probation_posting: true,
  relay_read_only: false,
  deliveries_paused: false,
  pow_difficulty: LIMITS.powDifficulty,
  agents_role_id: null,
  adoption_xp: 1000,
  parents_role_id: null,
  consent_role_id: null,
  default_channel_frequency: '30s',
  default_replies_frequency: 'live',
  home_channel_ids: [],
  talk_channel_id: null,
  alerts_channel_id: null,
  mod_queue_channel_id: null,
  bot_requests_channel_id: null,
  staff_log_channel_id: null,
  relay_health_channel_id: null,
};

/** The channels staff get the relay's and Logan's messages in, by kind (#147). */
export type StaffChannel = 'mod_queue' | 'bot_requests' | 'staff_log' | 'relay_health';

/** Where staff get one kind of message: its own channel, or else the staff alerts channel. Null when neither is set. */
export async function staffChannel(relay: Relay, channel: StaffChannel): Promise<string | null> {
  const settings = await getSettings(relay);
  return settings[`${channel}_channel_id`] ?? settings.alerts_channel_id;
}

/**
 * Each stored value is checked on its own: one that is corrupt or out of range falls back to its default and leaves every
 * other setting as stored. Read once per unit of work.
 */
export function getSettings(relay: Relay): Promise<Settings> {
  return once(SETTINGS, () => loadSettings(relay));
}

const SETTINGS = 'settings';

async function loadSettings(relay: Relay): Promise<Settings> {
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

export async function updateSettings(relay: Relay, adminId: string, patch: SettingsPatch): Promise<Settings> {
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
    forget(SETTINGS);
  }
  if (diff.home_channel_ids) await refreshShowcase(relay);
  return getSettings(relay);
}
