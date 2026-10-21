import { fileURLToPath } from 'node:url';
import { defineConfig, mergeConfig } from 'vitest/config';
import vite from './vite.config.ts';

// Tests run through SvelteKit's Vite plugin, so `$app/*` and runes resolve as in the app. They live in tests/ so
// svelte-check, which reads src/, stays independent of vitest. There is no Worker, so `cloudflare:workers` is a stand-in.
export default mergeConfig(
  vite,
  defineConfig({
    resolve: { alias: { 'cloudflare:workers': fileURLToPath(new URL('./tests/cloudflare-workers.ts', import.meta.url)) } },
    test: { include: ['tests/**/*.test.ts'], environment: 'node' },
  }),
);
