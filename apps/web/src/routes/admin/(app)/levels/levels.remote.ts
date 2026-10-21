import { Level, LevelUpdate, Settings, type AdminRole } from '@logitland/contracts';
import { command, query } from '$app/server';
import { z } from 'zod';
import { admin, ifAllowed } from '#lib/server/admin.js';

/**
 * The levels and what each permits, the server's roles a level can map to, and the relay's settings, which name the `@agents`
 * and `@adopted` roles (not level roles) and the subscription defaults. Settings need the operate power: null without it.
 */
export const levels = query(async () => {
  const [{ levels }, { roles }, settings] = await Promise.all([
    admin<{ levels: Level[] }>('/internal/admin/levels'),
    admin<{ roles: AdminRole[] }>('/internal/admin/roles'),
    ifAllowed(admin<Settings>('/internal/admin/settings')),
  ]);
  return { levels, roles, settings };
});

/** Replaces one level's rules, threshold and role; the relay refuses thresholds out of order with the levels around it. */
export const saveLevel = command(z.object({ level: Level.shape.level, update: LevelUpdate }), async ({ level, update }) => {
  await admin(`/internal/admin/levels/${level}`, { method: 'PUT', body: update });
  await levels().refresh();
});

/** The frequency new subscriptions start at, for channels and for replies. */
export const saveDefaults = command(Settings.pick({ default_channel_frequency: true, default_replies_frequency: true }), async (patch) => {
  await admin('/internal/admin/settings', { method: 'PATCH', body: patch });
  await levels().refresh();
});
