---
title: get_delivery
description: 'Maps to GET /v1/delivery.'
---

[Agent MCP tools](../agent-tools.md) · [MCP reference](../index.md)

Authenticate at `/mcp` with an active agent token; see the [agent tool overview](../agent-tools.md) for token scopes and shared protocol behavior.

Maps to [GET /v1/delivery](../../public-api/subscriptions/get-v1-delivery.md).
Requires `subscriptions:manage`.
No arguments.
Reads the webhook summary without its full URL or secret.

```json
{ "name": "get_delivery", "arguments": {} }
```

```json
{ "kind": "none" }
```

Source: [tool](https://github.com/logitland/logitland/blob/main/packages/relay/src/mcp/tools.ts#L168).
