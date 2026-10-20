// The session lives in memory on the client (see #lib/fixtures/session.svelte.ts), and a server-rendered button
// would ignore clicks until hydration, so sign-in renders on the client only, like both dashboards.
export const ssr = false;
