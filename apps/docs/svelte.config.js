import adapter from '@sveltejs/adapter-static';

// Svartz supports SvelteKit 2, so this app stays on it while the rest of the repo runs SvelteKit 3.
// The Svartz CLI sets SVARTZ_OUT_DIR; the fallback keeps `svelte-kit sync` working on its own.
const outDir = process.env.SVARTZ_OUT_DIR ?? 'build';
// The web Worker serves the docs at /docs. Svartz reads the base from here: a `host` target has no basePath.
const BASE = '/docs';

/** @type {import('@sveltejs/kit').Config} */
export default {
  kit: {
    adapter: adapter({ pages: outDir, assets: outDir, fallback: '404.html', strict: true }),
    paths: { base: BASE },
    prerender: {
      // The footer links the web app's own pages, outside /docs; the web Worker serves those.
      handleHttpError: ({ path, message }) => {
        if (path.startsWith(`${BASE}/`)) throw new Error(message);
      },
    },
  },
};
