import { signedIn } from '#lib/server/dashboard.js';

// Agents' pages still run on in-memory fixtures (see #lib/fixtures/owner); the signed-in person is real.
export const load = (event) => signedIn(event);
