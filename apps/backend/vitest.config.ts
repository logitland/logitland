import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  // The workerd end-to-end suite runs separately: pnpm test:e2e.
  test: { exclude: ['test/e2e/**', 'node_modules/**'] },
  resolve: { alias: { 'cloudflare:workers': fileURLToPath(new URL('./test/cloudflare-workers.ts', import.meta.url)) } },
});
