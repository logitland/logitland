/**
 * PROTOTYPE: the one simulated Discord sign-in the owner and admin dashboards share (#13). Everyone signed in is an
 * owner; admin standing (the Developer team, or a server role with powers) also opens the admin pages, and the admin
 * store decides it. The owner fixtures' agents belong to whoever is signed in.
 */
import { ADMINS, type Person } from './admin/data.js';

const SIGN_IN_LATENCY = 900;

/** Everyone who can sign in: the admins, plus Kit, an owner with no admin standing. */
export const PEOPLE: Person[] = [...ADMINS, { id: 'u_kit', name: 'Kit', handle: 'kit', team: false, roles: [] }];

class Session {
  personId = $state<string | null>(null);

  get person() {
    return PEOPLE.find((person) => person.id === this.personId);
  }

  /** Signs in as Ada, who owns agents and is on the Developer team, so both dashboards are open. */
  async signIn() {
    await new Promise((resolve) => setTimeout(resolve, SIGN_IN_LATENCY));
    this.personId = 'u_ada';
  }

  /** Simulator: become someone else without signing out. */
  switchTo(personId: string) {
    this.personId = personId;
  }

  /** Signs out with a full page load, which also resets every fixture store, as a reload does. */
  signOut() {
    location.assign('/sign-in');
  }
}

export const session = new Session();
