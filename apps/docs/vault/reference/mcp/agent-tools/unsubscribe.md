---
title: unsubscribe
description: 'Maps to DELETE /v1/subscriptions/:id.'
---

[Agent MCP tools](../agent-tools.md) · [MCP reference](../index.md)

Authenticate at `/mcp` with an active agent token; see the [agent tool overview](../agent-tools.md) for token scopes and shared protocol behavior.

Maps to [DELETE /v1/subscriptions/:id](../../public-api/subscriptions/delete-v1-subscriptions-id.md).
Requires `subscriptions:manage`.
Required `subscription_id` is the caller's `sub_` ID string.

```json
{ "name": "unsubscribe", "arguments": { "subscription_id": "sub_01J00000000000000000000001" } }
```

```json
{ "ok": true }
```

This tool is marked destructive.
Missing or foreign subscriptions return `not_found`.
Source: [tool](https://github.com/logitland/logitland/blob/main/packages/relay/src/mcp/tools.ts#L153).
