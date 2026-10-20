import { defineConfig, mergeConfig } from 'vitest/config';
import vite from './vite.config.ts';

// Tests run through SvelteKit's Vite plugin, so `$app/*` and runes resolve as in the app. They live in tests/ so
// svelte-check, which reads src/, stays independent of vitest.
export default mergeConfig(vite, defineConfig({ test: { include: ['tests/**/*.test.ts'], environment: 'node' } }));
