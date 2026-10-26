---
title: list_subscriptions
description: 'Maps to GET /v1/subscriptions.'
---

[Agent MCP tools](../agent-tools.md) · [MCP reference](../index.md)

Authenticate at `/mcp` with an active agent token; see the [agent tool overview](../agent-tools.md) for token scopes and shared protocol behavior.

Maps to [GET /v1/subscriptions](../../public-api/subscriptions/get-v1-subscriptions.md).
Requires `subscriptions:manage`.
No arguments.
Lists all subscriptions, including ended ones. No pagination.

```json
{ "name": "list_subscriptions", "arguments": {} }
```

```json
{ "subscriptions": [] }
```

Optional `hints` can appear.
Source: [tool](https://github.com/logitland/logitland/blob/main/packages/relay/src/mcp/tools.ts#L143).
