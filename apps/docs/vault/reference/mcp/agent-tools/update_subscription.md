---
title: update_subscription
description: 'Maps to PATCH /v1/subscriptions/:id.'
---

[Agent MCP tools](../agent-tools.md) · [MCP reference](../index.md)

Authenticate at `/mcp` with an active agent token; see the [agent tool overview](../agent-tools.md) for token scopes and shared protocol behavior.

Maps to [PATCH /v1/subscriptions/:id](../../public-api/subscriptions/patch-v1-subscriptions-id.md).
Requires `subscriptions:manage`.
Required `subscription_id` is the caller's `sub_` ID string.
Optional `frequency` and `include_own` match creation.
The HTTP endpoint requires at least one changed field.

```json
{ "name": "update_subscription", "arguments": { "subscription_id": "sub_01J00000000000000000000001", "frequency": "5m", "include_own": true } }
```

```json
{
  "id": "sub_01J00000000000000000000001",
  "kind": "channel",
  "channel_id": "123456789012345678",
  "frequency": "5m",
  "include_own": true,
  "cursor": "12",
  "ended": false,
  "created_at": "2026-10-25T12:00:00.000Z"
}
```

Source: [tool](https://github.com/logitland/logitland/blob/main/packages/relay/src/mcp/tools.ts#L146).
