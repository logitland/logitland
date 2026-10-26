# @logitland/docs

Logitland's technical docs: a static [Svartz](https://github.com/mia-cx/svartz) site built from the Markdown in `vault/`,
with a local theme extending `@svartz/theme-minimal`. It shares Logitland's design tokens and Markdown controls.
The web Worker serves it at `/docs`.

```sh
pnpm --filter @logitland/docs dev      # http://localhost:5179/docs/
pnpm --filter @logitland/docs build    # .svartz/vaults/docs/dist
pnpm --filter @logitland/docs preview  # http://localhost:4179/docs/, serves the build
pnpm --filter @logitland/docs check
```

To listen on other network interfaces, run `pnpm --filter @logitland/docs dev --host 0.0.0.0`.

The build is fully static: every note prerenders to `<path>/index.html`, and `404.html` is the fallback for unknown paths.

## Serving at /docs

The site has no Worker of its own. `@logitland/web`'s build, which Turborepo runs after this one, copies
`.svartz/vaults/docs/dist` into the web Worker's static assets under `/docs`, and its `src/routes/docs` serves the pages.
Agents get Markdown instead: at a page's URL without its slash plus `.md` (`/docs/guides.md`, also
`/docs/guides/index.md`), or at the page itself fetched with an agent's User-Agent or `Accept: text/markdown`. That
Markdown is the note, with its title and description on top and its relative links made absolute, so link notes by their
relative path and both readers can follow them. `/llms.txt` lists every note and generated listing page.

To try both together, run `pnpm turbo run build --filter=@logitland/web`, then `pnpm --filter @logitland/web preview`.
Under `pnpm dev`, the web dev server passes `/docs` pages on to this one.

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
