# @logitland/docs

Logitland's technical docs: a static [Svartz](https://github.com/mia-cx/svartz) site built from the Markdown in `vault/`.
Its theme composes Svartz's reference shell from the API docs theme's REST renderer and the MCP docs theme's tool
renderer, with Logitland's design tokens. The web Worker serves it at `/docs`.

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
Markdown is the copy Svartz writes beside each page: the note's frontmatter, operation and tool metadata included, then
its title and body. The web Worker makes its relative links absolute, so link notes by their relative path and both
readers can follow them. The page's **Copy page** and **View as Markdown** actions use the same copy. `/llms.txt` lists
every note, from the build's own `/docs/llms.txt`, and every generated listing page.

To try both together, run `pnpm turbo run build --filter=@logitland/web`, then `pnpm --filter @logitland/web preview`.
Under `pnpm dev`, the web dev server passes `/docs` pages on to this one.

## Writing notes

- Frontmatter `title` is the page heading, and search and the sidebar use it; endpoints and tools list there by path or
  name. `description` is the summary.
- Leave out a `# Title` line: the theme already prints `title` as the heading, so the page would show it twice.
- A folder's `index.md` is that folder's page, at `/<folder>/`.
- A folder's note titles its sidebar group, so a note needs no "back to section" link.
- Link notes with relative Markdown paths, such as `[Public API](../public-api/index.md#errors)`. They resolve from the
  linking note, and the build fails on a link to an anchor that doesn't exist.
- Write `https://relay.example` for the site the docs are on, in links, prompts and examples alike:
  `[skill.md](https://relay.example/skill.md)`. Whatever serves the docs (the web Worker, or its dev server under
  `pnpm dev`) names its own origin there in every page, script and Markdown copy, so staging's docs point at staging,
  production's at production, and a local server's at itself. `wss://relay.example` becomes the matching WebSocket
  origin and a bare `relay.example` the host. Readers never have to pick an environment to follow a page.

## Reference pages

A note's frontmatter picks how it renders. The upstream format is Svartz's
[reference themes](https://github.com/mia-cx/svartz/blob/sveltekit-rewrite/docs/reference-themes.md) guide.

- `operation` with `method` and `path` (`/v1/messages/{id}`): an HTTP endpoint. Parameters, request body and responses
  render on the left, generated cURL, JavaScript and Python requests and each response's example on the right.
  Requests go to the site's own origin, `https://relay.example`; an endpoint elsewhere names its origin in
  `operation.server` (`http://127.0.0.1:8790` for the fake Discord, `https://relay` for the internal API's binding).
- `operation` with `protocol: mcp`: an MCP tool. Its `inputSchema` and `annotations` are the relay's own `tools/list`
  entries; examples show each `tools/call` request and result.
- `model`: a schema. `reference/schemas` holds the contracts that responses name with `$ref`.
- Neither: a guide, such as a WebSocket upgrade, a method rejection, a browser route, or a remote function.

`auth` takes `bearer`, `basic` or `none`; only `bearer` and `basic` put an `Authorization` header in the examples. Other
credentials (internal headers, `Bot` tokens, signatures, cookies) are header or cookie parameters. Give a response a
`schema` only with an `example` from the docs, so the examples column never shows generated placeholders.

The examples read each success response by what it holds, so a success with neither `schema` nor `example` names its
`contentType` (`application/json`, `text/markdown`, `image/png`); without one it reads as text. A success with no body
sets `empty: true`, except 204, which needs nothing. OAuth token and revocation bodies set
`requestBody.contentType: application/x-www-form-urlencoded`, so the examples send form fields.

A folder note's `order` places its sidebar section or group, lowest first. Every folder note in a family shares its
parent's number (all of `reference/public-api` is `1`), so nested groups stay together in path order. Move curl examples,
request and response JSON, and source links into the metadata (`source` lists the source links); the body keeps what
the metadata can't say.

## Stack

The app is Svartz's host template: `svartz.config.ts` mounts `vault/` as a host vault, and `src/routes/[...slug]` renders
each note with `@svartz/ui`. `theme/` is a directory theme: `index.js` is the reference shell's build manifest and
`runtime.js` lists its renderers. The Svartz CLI runs Vite, so use the package scripts rather than `vite` directly.

It runs SvelteKit 2 (`@sveltejs/kit` 2.70.3, `@sveltejs/adapter-static` 3.0.10), the range Svartz supports, with the
repo's catalog Vite, vite-plugin-svelte, Svelte, Tailwind and TypeScript 6. The rest of the repo is on SvelteKit 3.
