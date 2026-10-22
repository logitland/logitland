/**
 * The one Discord sign-in the owner and admin dashboards share (#13), as the dashboards' layouts load it (see
 * `#lib/server/dashboard.ts`). Everyone signed in is an owner; admin standing (the Developer team, or a server role with
 * powers) also opens the admin pages.
 */
import type { AdminPermission } from '@logitland/contracts';
import { page } from '$app/state';

/** A signed-in Discord account: its owner ID, and its name, handle and avatar URL as the account menu shows them. */
export type Person = { id: string; name: string; handle: string; avatar?: string };

export const session = {
  /** Who is signed in, on a dashboard page. */
  get person() {
    return page.data.person ?? undefined;
  },

  /** What the relay lets them do as an admin: nothing, some powers, or everything (`full`). */
  get standing() {
    return page.data.standing ?? undefined;
  },

  /** Whether they hold an admin power; `full` is the Developer team's alone. */
  can(power: AdminPermission | 'full') {
    const standing = page.data.standing;
    return power === 'full' ? (standing?.full ?? false) : (standing?.permissions.includes(power) ?? false);
  },

  /** Ends the session with a full page load, which also resets every fixture store, as a reload does. */
  async signOut() {
    await fetch('/auth/sign-out', { method: 'POST' });
    location.assign('/sign-in');
  },
};
