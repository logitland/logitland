import { AdminRoleUpdate, Snowflake, type AdminRole, type DeveloperTeam, type Level, type Settings } from '@logitland/contracts';
import { command, query } from '$app/server';
import { z } from 'zod';
import { admin } from '#lib/server/admin.js';

/**
 * Who the admins are: the Developer team (full admins), and the server roles that can grant narrower powers, with what each
 * grants. `@agents` and level roles are left out: they're agents' roles. Full admins only.
 */
export const admins = query(async () => {
  const [{ members }, { roles }, settings, { levels }] = await Promise.all([
    admin<DeveloperTeam>('/internal/admin/team'),
    admin<{ roles: AdminRole[] }>('/internal/admin/roles'),
    admin<Settings>('/internal/admin/settings'),
    admin<{ levels: Level[] }>('/internal/admin/levels'),
  ]);
  const agentRoles = new Set([settings.agents_role_id, ...levels.map((l) => l.role_id)]);
  return { team: members, roles: roles.filter((r) => !agentRoles.has(r.id)) };
});

/** Sets what each changed role grants; an empty list takes a role's powers away. Each change is audited. */
export const saveRoles = command(z.array(z.object({ id: Snowflake, permissions: AdminRoleUpdate.shape.permissions })), async (changes) => {
  for (const { id, permissions } of changes) await admin(`/internal/admin/roles/${id}`, { method: 'PUT', body: { permissions } });
  await admins().refresh();
});
