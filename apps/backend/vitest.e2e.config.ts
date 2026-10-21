import { defineConfig } from 'vitest/config';

// The workerd end-to-end suite: the real Worker under wrangler, a temporary D1 database and a fake Discord.
// `pnpm test:e2e`. The default config also finds these files, but they skip themselves without LOGITLAND_E2E.
export default defineConfig({
  test: {
    include: ['test/e2e/**/*.test.ts'],
    environment: 'node',
    env: { LOGITLAND_E2E: '1' },
    testTimeout: 60_000,
    hookTimeout: 60_000,
    pool: 'forks',
    // Each file runs its own workerd, fake Discord and database. Run in parallel they compete for the machine, and the
    // Gateway scenarios' timing waits (resume after a restart) then fail now and then. One file at a time keeps them honest.
    fileParallelism: false,
  },
});
