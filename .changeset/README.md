# Changesets

A release is a version of Logitland: the relay (`@logitland/backend`) and the web app (`@logitland/web`), versioned together.
Describe a change people would notice with `pnpm changeset`, naming either app; the libraries in `packages/` ship inside them
and take no changesets.

On `main`, the release workflow keeps a "chore: version packages" pull request open while changesets are pending.
Merging it versions both apps and creates their release tags; it does not deploy production automatically.
Run the production deployment from a release tag as described in the [deployment runbook](../DEPLOY.md#releases).
