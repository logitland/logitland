/**
 * The one Discord sign-in the owner and admin dashboards share (#13), as the dashboards' layouts load it (see
 * `#lib/server/dashboard.ts`). Everyone signed in is an owner; admin standing (the Developer team, or a server role with
 * powers) also opens the admin pages.
 */
import { page } from '$app/state';

export const session = {
  /** Who is signed in, on a dashboard page. */
  get person() {
    return page.data.person ?? undefined;
  },

  /** What the relay lets them do as an admin: nothing, some powers, or everything (`full`). */
  get standing() {
    return page.data.standing ?? undefined;
  },

  /** Ends the session with a full page load, which also resets every fixture store, as a reload does. */
  async signOut() {
    await fetch('/auth/sign-out', { method: 'POST' });
    location.assign('/sign-in');
  },
};
