# Prototype

Clickable HTML prototype of the owner dashboard and admin console: 15 screens plus a screen index, in plain HTML.
This is a design artifact, not the production app in `apps/web`.
Its styles and behaviour come from `@logitland/tokens` and `@logitland/ui`; `scripts/build.mjs` assembles them into `dist/assets/`.

From the repository root, install dependencies with `pnpm install`, then start the prototype:

```bash
pnpm --filter @logitland/prototype dev
```

Then open http://127.0.0.1:4321/. `pages/index.html` is authored as a fragment because the artifact host wraps it in a document skeleton; the dev server wraps it the same way.

## How a page works

- Markup uses the shared classes from `@logitland/ui/ui.css`. Inline styles are limited to CSS custom properties (`--w`, `--size`, `--gap` and so on).
- Behaviour is declared with data attributes and handled by `@logitland/ui/dom`:
  - `data-state` / `data-when` / `data-set` for page states; `role="tablist"` for tabs.
  - `data-filter` and `data-search` for lists; `data-copy` for copying.
  - `data-open` / `data-close` on native dialogs.
  - `data-countdown` / `data-ago` / `data-tick` for live values.
  - `data-scenarios` on `<body>` for prototype-only scenarios.
- Short text that changes gets `data-morph` and changes through torph, so words and digits morph instead of snapping.
- Page-specific logic sits in one `<script type="module">` that imports helpers from `./assets/logitland.js`.

All motion respects `prefers-reduced-motion`. Navigation between pages uses cross-document view transitions where the browser supports them.
