import { Snowflake, type AdminChannel, type AdminHealth, type AdminRole, type SetupReport, type Settings } from '@logitland/contracts';
import { command, query } from '$app/server';
import { z } from 'zod';
import { KILL_SWITCH_KEYS, KILL_SWITCHES, ROLE_KEYS, type RoleKey } from '#lib/admin/labels.js';
import { admin } from '#lib/server/admin.js';

/** The relay's health: the Gateway, Jev, the held queue, the delivery backlog, the bot's permissions and the kill switches. */
export const health = query(() => admin<AdminHealth>('/internal/admin/health'));

/**
 * What the health page changes besides the switches: whether the /consent command is registered (from the setup checklist,
 * which asks Discord), the channel staff alerts go to, picked from the channels the bot can see, and which of the server's
 * roles the relay uses (role IDs differ per server, so admins pick them).
 */
export const operations = query(async () => {
  const [{ checks }, settings, { channels }, { roles }] = await Promise.all([
    admin<SetupReport>('/internal/admin/setup'),
    admin<Settings>('/internal/admin/settings'),
    admin<{ channels: AdminChannel[] }>('/internal/admin/channels'),
    admin<{ roles: AdminRole[] }>('/internal/admin/roles'),
  ]);
  return {
    commands: checks.find((c) => c.id === 'consent-command') ?? null,
    alertsChannelId: settings.alerts_channel_id,
    channels: channels.filter((c) => !c.hidden).map(({ id, name }) => ({ id, name })),
    roleIds: Object.fromEntries(ROLE_KEYS.map((key) => [key, settings[key]])) as Record<RoleKey, string | null>,
    roles: roles.map(({ id, name }) => ({ id, name })),
  };
});

/** Turns a kill switch on or off. */
export const setSwitch = command(z.object({ key: z.enum(KILL_SWITCH_KEYS), on: z.boolean() }), async ({ key, on }) => {
  const { engaged } = KILL_SWITCHES[key];
  await admin('/internal/admin/settings', { method: 'PATCH', body: { [key]: on ? engaged : !engaged } });
  await health().refresh();
});

/** Registers the /consent slash command in the server, replacing this app's commands there. */
export const registerCommands = command(async () => {
  await admin('/internal/admin/discord/commands', { method: 'POST' });
  await operations().refresh();
});

/** Which server role the relay uses for one purpose; null uses none. */
export const setRole = command(z.object({ key: z.enum(ROLE_KEYS), roleId: Snowflake.nullable() }), async ({ key, roleId }) => {
  await admin('/internal/admin/settings', { method: 'PATCH', body: { [key]: roleId } });
  await operations().refresh();
});

/** Where the bot posts operational alerts; null posts none. */
export const setAlertsChannel = command(Snowflake.nullable(), async (channelId) => {
  await admin('/internal/admin/settings', { method: 'PATCH', body: { alerts_channel_id: channelId } });
  await operations().refresh();
});
