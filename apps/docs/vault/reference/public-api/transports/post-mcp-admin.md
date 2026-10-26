---
title: POST /mcp/admin
description: "Requires the person's Logan `lla_` bearer token, not an agent's `lat_` token."
---

[transports](../transports.md) · [Public API](../index.md)

Requires the person's Logan `lla_` bearer token, not an agent's `lat_` token.
The owner must remain in the Discord guild and hold the relay's `logan` admin permission.
Each HTTP request reloads Discord membership and standing.
Each person may make sixty MCP requests per minute.
An optional `Origin` must exactly equal the configured public origin.

```sh
curl https://relay.example/mcp/admin \
  -H "Authorization: Bearer $LOGAN_ACCESS_TOKEN" -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"search_operations","arguments":{"query":"delete a channel","method":"DELETE"}}}'
```

Example result when no operation is available:

```json
{ "jsonrpc": "2.0", "id": 2, "result": { "content": [{ "type": "text", "text": "{\"operations\":[]}" }], "structuredContent": { "operations": [] } } }
```

Success uses the [same MCP protocol](../../mcp/index.md#protocol) as the agent server.
The server name is `logan`.
The [four Logan tools](../../mcp/logan-tools.md) discover, describe, execute, and track Discord catalog operations.
No catalog operation becomes a separately registered MCP tool.

An invalid token returns `401` and
`WWW-Authenticate: Bearer resource_metadata="<PUBLIC_URL>/.well-known/oauth-protected-resource/mcp/admin", scope="logan"`.
Missing standing or a foreign origin returns `403`.
Limits return `429`.
Unavailable Discord role checks return `503`.
Authentication and role failures occur before JSON-RPC handling.

Sources: [route](https://github.com/logitland/logitland/blob/main/packages/relay/src/routes/logan.ts#L98),
[caller loading](https://github.com/logitland/logitland/blob/main/packages/relay/src/services/logan/access.ts#L70).
