// Builds the static prototype into dist/: copies the pages and assembles assets/logitland.css
// (tokens + UI) and assets/logitland.js (the data-attribute behaviours, with flock and torph bundled).
import { build, context } from 'esbuild';
import { copyFile, mkdir, readFile, readdir, rm, writeFile, watch } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const app = join(here, '..');
const dist = join(app, 'dist');
const require = createRequire(import.meta.url);
const tokensCss = require.resolve('@logitland/tokens/tokens.css');
const uiCss = require.resolve('@logitland/ui/ui.css');
const domEntry = require.resolve('@logitland/ui/dom');

async function pages() {
  await mkdir(dist, { recursive: true });
  for (const f of await readdir(join(app, 'pages'))) if (f.endsWith('.html')) await copyFile(join(app, 'pages', f), join(dist, f));
}

async function css() {
  await mkdir(join(dist, 'assets'), { recursive: true });
  const [tokens, ui] = await Promise.all([readFile(tokensCss, 'utf8'), readFile(uiCss, 'utf8')]);
  await writeFile(join(dist, 'assets', 'logitland.css'), `${tokens}\n${ui}`);
}

const jsOptions = { entryPoints: [domEntry], outfile: join(dist, 'assets', 'logitland.js'), bundle: true, format: 'esm', target: 'es2022', minify: true, legalComments: 'none', logLevel: 'warning' };

const watching = process.argv.includes('--watch');
await rm(dist, { recursive: true, force: true });
await Promise.all([pages(), css()]);
if (!watching) {
  await build(jsOptions);
  console.log('prototype built to dist/');
} else {
  const ctx = await context(jsOptions);
  await ctx.watch();
  console.log('watching pages, tokens and ui');
  const watchers = [[join(app, 'pages'), pages], [dirname(tokensCss), css], [dirname(uiCss), css]];
  for (const [dir, fn] of watchers) (async () => { for await (const _ of watch(dir)) await fn().catch((e) => console.error(e)); })();
}
