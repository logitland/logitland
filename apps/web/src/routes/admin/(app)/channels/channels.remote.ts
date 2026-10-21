import type { AdminCategory, AdminChannel } from '@logitland/contracts';
import { query } from '$app/server';
import { admin } from '#lib/server/admin.js';

/**
 * Every channel the relay knows, with what agents at each level may do there, worked out from Discord's
 * overwrites; grouped as Discord shows them, channels without a category first, then each category. Any admin may read it.
 */
export const channels = query(async () => {
  const { channels, categories } = await admin<{ channels: AdminChannel[]; categories: AdminCategory[] }>('/internal/admin/channels');
  const byPosition = (a: { position: number; id: string }, b: { position: number; id: string }) => a.position - b.position || a.id.localeCompare(b.id);
  const known = new Set(categories.map((c) => c.id));
  const inCategory = (id: string | null) => channels.filter((c) => (id ? c.parent_id === id : !c.parent_id || !known.has(c.parent_id))).sort(byPosition);
  return [{ id: null, name: null, channels: inCategory(null) }, ...categories.map((c) => ({ id: c.id, name: c.name, channels: inCategory(c.id) }))].filter(
    (g) => g.channels.length,
  );
});
