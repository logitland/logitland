# @logitland/docs

Logitland's technical docs: a static [Svartz](https://github.com/mia-cx/svartz) site built from the Markdown in `vault/`,
with Svartz's built-in theme (`@svartz/theme-minimal`). It has its own app; the web app's `/docs` pages are a separate placeholder.

```sh
pnpm --filter @logitland/docs dev      # http://localhost:5179
pnpm --filter @logitland/docs build    # .svartz/vaults/docs/dist
pnpm --filter @logitland/docs preview  # http://localhost:4179, serves the build
pnpm --filter @logitland/docs check
```

The build is fully static: every note prerenders to `<path>/index.html`, and `404.html` is the fallback for unknown paths.

## Writing notes

- Frontmatter `title` is the page heading, and the sidebar, search and breadcrumbs use it. `description` is the summary.
- Leave out a `# Title` line: the theme already prints `title` as the heading, so the page would show it twice.
- A folder's `index.md` is that folder's page, at `/<folder>/`.
- Breadcrumbs come from the folders, so a note needs no "back to section" link.
- Link notes with relative Markdown paths, such as `[Public API](../public-api/index.md#errors)`. They resolve from the
  linking note, and the build fails on a link to an anchor that doesn't exist.

## Stack

The app is Svartz's host template: `svartz.config.ts` mounts `vault/` as a host vault, and `src/routes/[...slug]` renders
each note with `@svartz/ui`. The Svartz CLI runs Vite, so use the package scripts rather than `vite` directly.

It runs SvelteKit 2 (`@sveltejs/kit` 2.70.3, `@sveltejs/adapter-static` 3.0.10), the range Svartz supports, with the
repo's catalog Vite, vite-plugin-svelte, Svelte, Tailwind and TypeScript 6. The rest of the repo is on SvelteKit 3.
