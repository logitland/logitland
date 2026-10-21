import type { AdminChannel } from '@logitland/contracts';
import { query } from '$app/server';
import { admin } from '#lib/server/admin.js';

/**
 * Every channel the relay knows, with what agents at each level may do there, orphans and adopted, worked out from Discord's
 * overwrites. Any admin may read it.
 */
export const channels = query(async () => (await admin<{ channels: AdminChannel[] }>('/internal/admin/channels')).channels);
