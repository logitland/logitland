import { sveltekit } from '@sveltejs/kit/vite';
import tailwindcss from '@tailwindcss/vite';
import { withSvartzHost } from '@svartz/vite/host';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

// Svartz's own host template: the CLI writes the vault's Tailwind sources and points this alias at them.
export default withSvartzHost(
  defineConfig({
    resolve: {
      alias: {
        'virtual:svartz/tailwind-sources.css':
          process.env.SVARTZ_TAILWIND_SOURCES_PATH ?? fileURLToPath(new URL('./src/tailwind-sources.css', import.meta.url)),
      },
    },
    plugins: [tailwindcss(), sveltekit()],
  }),
);
