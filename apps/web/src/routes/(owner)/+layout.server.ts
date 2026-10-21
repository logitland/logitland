import { signedIn } from '#lib/server/dashboard.js';

// Agents' pages read and write the relay through #lib/owner/owner.remote.ts, for the signed-in person.
export const load = (event) => signedIn(event);
