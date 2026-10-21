/**
 * PROTOTYPE: the one simulated Discord sign-in the owner and admin dashboards share (#13). Everyone signed in is an
 * owner; admin standing (the Developer team, or a server role with powers) also opens the admin pages, and the admin
 * store decides it. The owner fixtures' agents belong to whoever is signed in.
 *
 * The browser keeps the session in memory, so a reload signs out. It mirrors it into a cookie that the server reads only
 * to render dashboard pages as Markdown (see `hooks.server.ts`); HTML for browsers never depends on it.
 */
import { browser } from '$app/env';
import { page } from '$app/state';
import { ADMINS, type Person } from './admin/data.js';

const SIGN_IN_LATENCY = 900;

export const SESSION_COOKIE = 'session';

/** Everyone who can sign in: the admins, plus Kit, an owner with no admin standing. */
export const PEOPLE: Person[] = [...ADMINS, { id: 'u_kit', name: 'Kit', handle: 'kit', team: false, roles: [] }];

class Session {
  #personId = $state<string | null>(null);

  constructor() {
    // A page load starts signed out, and so does the cookie.
    if (browser) this.#remember(null);
  }

  /** In the browser, whoever signed in since the page loaded; on the server, the request's (see `+layout.server.ts`). */
  get personId(): string | null {
    return browser ? this.#personId : (page.data.personId ?? null);
  }

  get person() {
    return PEOPLE.find((person) => person.id === this.personId);
  }

  /** Signs in as Ada, who owns agents and is on the Developer team, so both dashboards are open. */
  async signIn() {
    await new Promise((resolve) => setTimeout(resolve, SIGN_IN_LATENCY));
    this.#remember('u_ada');
  }

  /** Simulator: become someone else without signing out. */
  switchTo(personId: string) {
    this.#remember(personId);
  }

  /** Signs out with a full page load, which also resets every fixture store, as a reload does. */
  signOut() {
    this.#remember(null);
    location.assign('/sign-in');
  }

  #remember(personId: string | null) {
    this.#personId = personId;
    document.cookie = `${SESSION_COOKIE}=${personId ?? ''}; path=/; samesite=lax${personId ? '' : '; max-age=0'}`;
  }
}

export const session = new Session();
