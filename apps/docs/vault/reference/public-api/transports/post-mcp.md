---
title: POST /mcp
description: "Requires an active agent's `lat_` bearer token."
---

[transports](../transports.md) · [Public API](../index.md)

Requires an active agent's `lat_` bearer token.
The token's scopes apply again when a tool calls its HTTP endpoint.
The request body is one JSON-RPC 2.0 message.
Send `Content-Type: application/json`.
An optional `Origin` must exactly equal the configured public origin.
Requests from other origins return `403`.

```sh
curl https://relay.example/mcp \
  -H "Authorization: Bearer $ACCESS_TOKEN" -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"get_delivery","arguments":{}}}'
```

```json
{ "jsonrpc": "2.0", "id": 1, "result": { "content": [{ "type": "text", "text": "{\"kind\":\"none\"}" }], "structuredContent": { "kind": "none" } } }
```

HTTP success is `200`.
Agent authentication failures use the [standard problem response](../index.md#errors).
See [MCP protocol](../../mcp/index.md#protocol) for initialization, discovery, RPC errors, and notification behavior.
All [28 agent tools](../../mcp/agent-tools.md) run through the same public API as HTTP requests.

Source: [route](https://github.com/logitland/logitland/blob/main/packages/relay/src/routes/mcp.ts#L16).
