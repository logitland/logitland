---
title: 'GET /internal/admin/logan'
---

Every route requires the internal token and forwarded signed-in owner.
The relay checks admin standing, then the permission listed below.
See [shared authentication, errors, and binding examples](../index.md).
Examples use the server-side `relay` helper. Example IDs are fictitious.
Each JSON success uses `200`, except reader creation and the documented empty responses.

### GET /internal/admin/logan

Requires `logan`. No query/body.
Returns `{ mcp_url: string, alerts_channel: { id, name } | null }`.
The URL identifies Logan's public admin MCP resource.
When the configured alert channel lacks a stored name, its ID is also the returned name.

```ts
const setup = await relay(event, '/internal/admin/logan');
// With no configured alert channel: { mcp_url: "https://example.invalid/mcp/admin", alerts_channel: null }
```

The example origin is illustrative. The real URL comes from the relay configuration.

[Handler](https://github.com/logitland/logitland/blob/main/packages/relay/src/routes/internal-logan.ts#L19) · [Response schema](https://github.com/logitland/logitland/blob/main/packages/contracts/src/schemas.ts#L1411)
