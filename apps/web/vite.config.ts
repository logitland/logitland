import adapter from '@sveltejs/adapter-cloudflare';
import { sveltekit } from '@sveltejs/kit/vite';
import tailwindcss from '@tailwindcss/vite';
import { existsSync } from 'node:fs';
import { defineConfig } from 'vite';

/**
 * The settings that match the local relay, in place of .dev.vars: the file `pnpm dev:full` names, or the one
 * `pnpm dev:setup` wrote. Without either, wrangler reads .dev.vars as usual.
 */
function stackSettings() {
  const file = process.env.LOGITLAND_WEB_ENV_FILE ?? '../backend/.wrangler/dev/web.env';
  return existsSync(file) ? [file] : undefined;
}

export default defineConfig({
  plugins: [
    tailwindcss(),
    sveltekit({
      compilerOptions: {
        // Runes everywhere in this app; dependencies decide for themselves.
        runes: ({ filename }) => (filename.split(/[/\\]/).includes('node_modules') ? undefined : true),
        // Pages await remote functions' data in their markup.
        experimental: { async: true },
      },
      // The dashboards read and write the relay through `*.remote.ts` files.
      experimental: { remoteFunctions: true },
      adapter: adapter({ platformProxy: { envFiles: stackSettings() } }),
    }),
  ],
});
