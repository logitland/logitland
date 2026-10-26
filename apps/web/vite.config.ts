import adapter from '@sveltejs/adapter-cloudflare';
import { sveltekit } from '@sveltejs/kit/vite';
import tailwindcss from '@tailwindcss/vite';
import { existsSync } from 'node:fs';
import { defineConfig, type ProxyOptions } from 'vite';
import { wantsMarkdown } from './src/lib/server/markdown/negotiate.ts';

/**
 * The settings that match the local relay, in place of .dev.vars: the file `pnpm dev:full` names, or the one
 * `pnpm dev:setup` wrote. Without either, wrangler reads .dev.vars as usual.
 */
function stackSettings() {
  const file = process.env.LOGITLAND_WEB_ENV_FILE ?? '../backend/.wrangler/dev/web.env';
  return existsSync(file) ? [file] : undefined;
}

/**
 * The local relay. Deployed, the shared hostname sends /v1/* to the relay Worker; in development the dev server passes it
 * on, WebSockets included, so the home page's live feed answers on the page's own origin.
 */
const RELAY_URL = process.env.LOGITLAND_RELAY_URL ?? 'http://localhost:8787';

/** The docs dev server (apps/docs, which `pnpm dev` also starts). Built, the docs are this Worker's assets under /docs. */
const DOCS_URL = process.env.LOGITLAND_DOCS_URL ?? 'http://localhost:5179';
/** Docs pages and their files, but not their Markdown (`/docs/guides.md`), which the hook answers from the vault. */
const DOCS_PAGES = String.raw`^/docs(?![^?]*\.md(\?|$))([/?]|$)`;

/** Passes the docs to their dev server, except a request that wants Markdown: the hook answers it, as when deployed. */
const docsProxy: ProxyOptions = {
  target: DOCS_URL,
  bypass: ({ url, headers }) => {
    const sent = Object.entries(headers).filter((header): header is [string, string] => typeof header[1] === 'string');
    return wantsMarkdown(new Headers(sent)) ? url : undefined;
  },
};

export default defineConfig({
  server: { proxy: { '/v1': { target: RELAY_URL, ws: true }, [DOCS_PAGES]: docsProxy } },
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
