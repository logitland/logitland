---
title: Read Logan connection
description: Read Logan's public admin MCP URL and alert channel.
operation:
  method: GET
  path: /internal/admin/logan
  server: https://relay
  parameters:
    - name: x-logitland-internal
      in: header
      required: true
      type: string
      description: The dashboard token.
    - name: x-logitland-owner
      in: header
      required: true
      type: string
      description: The forwarded owner, who needs the `logan` admin permission.
  responses:
    '200':
      description: The MCP URL and configured alerts channel.
      example:
        mcp_url: https://relay.example/mcp/admin
        alerts_channel: null
source:
  - label: Handler
    href: https://github.com/logitland/logitland/blob/main/packages/relay/src/routes/internal-logan.ts#L19
  - label: Response schema
    href: https://github.com/logitland/logitland/blob/main/packages/contracts/src/schemas.ts#L1490
---

Returns `{ mcp_url: string, alerts_channel: { id, name } | null }`. The URL identifies Logan's public admin MCP resource. When the configured alert channel lacks a stored name, its ID is also the returned name.
The URL comes from the relay's configured public origin.
See [shared authentication, errors, and binding examples](../index.md).
