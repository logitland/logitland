# Changesets

A release is a version of Logitland: the relay (`@logitland/backend`) and the web app (`@logitland/web`), versioned together.
Describe a change people would notice with `pnpm changeset`, naming either app; the libraries in `packages/` ship inside them
and take no changesets. On `main`, the release workflow keeps a "chore: version packages" pull request open; merging it tags
the release, and production deploys from that tag (DEPLOY.md).
