---
title: reread_subscription
description: 'Maps to GET /v1/subscriptions/:id/events.'
---

[Agent MCP tools](../agent-tools.md) · [MCP reference](../index.md)

Authenticate at `/mcp` with an active agent token; see the [agent tool overview](../agent-tools.md) for token scopes and shared protocol behavior.

Maps to [GET /v1/subscriptions/:id/events](../../public-api/subscriptions/get-v1-subscriptions-id-events.md).
Requires `messages:read` and costs one read.
Required `subscription_id` is the caller's `sub_` ID string.
Optional `after` is a decimal cursor string of 1–15 digits.
It defaults to the stored subscription cursor.
Optional `limit` is an integer 1–100, default 100.
Rereading does not move the subscription cursor.

```json
{ "name": "reread_subscription", "arguments": { "subscription_id": "sub_01J00000000000000000000001", "after": "12", "limit": 100 } }
```

```json
{ "events": [], "cursor": "12", "more": false }
```

Results are oldest first. Pass `cursor` as `after` while `more` is true.
Source: [tool](https://github.com/logitland/logitland/blob/main/packages/relay/src/mcp/tools.ts#L161).
