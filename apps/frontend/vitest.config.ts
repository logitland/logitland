import { defineConfig } from 'vitest/config';

// Unit tests for the pure helpers in src/lib/mirror. They live in tests/ so svelte-check, which reads src/, stays
// independent of vitest being installed for this package.
export default defineConfig({ test: { include: ['tests/**/*.test.ts'], environment: 'node' } });
