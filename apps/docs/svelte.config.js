import adapter from '@sveltejs/adapter-static';

// Svartz supports SvelteKit 2, so this app stays on it while the rest of the repo runs SvelteKit 3.
// The Svartz CLI sets SVARTZ_OUT_DIR and SVARTZ_BASE_PATH; the fallbacks keep `svelte-kit sync` working on its own.
const outDir = process.env.SVARTZ_OUT_DIR ?? 'build';

/** @type {import('@sveltejs/kit').Config} */
export default {
  kit: {
    adapter: adapter({ pages: outDir, assets: outDir, fallback: '404.html', strict: true }),
    paths: { base: process.env.SVARTZ_BASE_PATH ?? '' },
  },
};
