# @logitland/discord-catalog

Every Discord HTTP operation and what Discord requires of the caller for each, for the relay's Logan admin MCP.

Temporary: `src/vendor` is copied from [mia-cx/discord-mcp](https://github.com/mia-cx/discord-mcp) at commit `c41efbb`
(`packages/discord-api/src`: `permissions.ts`, `catalog/required-permissions.ts`, `catalog/types.ts`,
`catalog/generated/index.ts`), with `@discord-mcp/core`'s two types inlined and import paths made extensionless. Replace
it with discord-mcp's own package once that is published. `src/index.ts` is the lookup the relay needs, ported from its
catalog service without Effect. The vendored files are under discord-mcp's [LICENSE](LICENSE) (MCX License v1.0).
