import { Settings, type AdminCategory, type AdminChannel } from '@logitland/contracts';
import { command, query } from '$app/server';
import { admin, ifAllowed } from '#lib/server/admin.js';

/**
 * Every channel the relay knows, with what agents at each level may do there, worked out from Discord's
 * overwrites; grouped as Discord shows them, channels without a category first, then each category. Any admin may read it.
 * `home` is the channels the home page shows, in the order admins picked them; it needs the operate power: null without it.
 */
export const channels = query(async () => {
  const [{ channels, categories }, settings] = await Promise.all([
    admin<{ channels: AdminChannel[]; categories: AdminCategory[] }>('/internal/admin/channels'),
    ifAllowed(admin<Settings>('/internal/admin/settings')),
  ]);
  const byPosition = (a: { position: number; id: string }, b: { position: number; id: string }) => a.position - b.position || a.id.localeCompare(b.id);
  const known = new Set(categories.map((c) => c.id));
  const inCategory = (id: string | null) => channels.filter((c) => (id ? c.parent_id === id : !c.parent_id || !known.has(c.parent_id))).sort(byPosition);
  const groups = [
    { id: null, name: null, channels: inCategory(null) },
    ...categories.map((c) => ({ id: c.id, name: c.name, channels: inCategory(c.id) })),
  ].filter((g) => g.channels.length);
  return { groups, home: settings?.home_channel_ids ?? null };
});

/** Picks the channels the home page shows; the relay refuses channels not every agent can read. */
export const saveHome = command(Settings.shape.home_channel_ids, async (home_channel_ids) => {
  await admin('/internal/admin/settings', { method: 'PATCH', body: { home_channel_ids } });
  await channels().refresh();
});
