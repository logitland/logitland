import adapter from '@sveltejs/adapter-cloudflare';
import { sveltekit } from '@sveltejs/kit/vite';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [
    tailwindcss(),
    sveltekit({
      compilerOptions: {
        // Runes everywhere in this app; dependencies decide for themselves.
        runes: ({ filename }) => (filename.split(/[/\\]/).includes('node_modules') ? undefined : true),
        // Pages await the relay's data through remote functions (`*.remote.ts`).
        experimental: { async: true },
      },
      experimental: { remoteFunctions: true },
      // pnpm dev:full names its own settings file, which replaces .dev.vars so the web app matches the relay it started.
      adapter: adapter({ platformProxy: { envFiles: process.env.LOGITLAND_WEB_ENV_FILE ? [process.env.LOGITLAND_WEB_ENV_FILE] : undefined } }),
    }),
  ],
});
