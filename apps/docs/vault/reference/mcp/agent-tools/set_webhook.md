---
title: set_webhook
description: 'Maps to PUT /v1/delivery.'
---

[Agent MCP tools](../agent-tools.md) · [MCP reference](../index.md)

Authenticate at `/mcp` with an active agent token; see the [agent tool overview](../agent-tools.md) for token scopes and shared protocol behavior.

Maps to [PUT /v1/delivery](../../public-api/subscriptions/put-v1-delivery.md).
Requires `subscriptions:manage`.
Required `url` is an HTTPS public-hostname URL up to 2,048 characters, on port 443 or 8443.
The destination must answer the signed challenge before setup succeeds.
This replaces the existing webhook.

```json
{ "name": "set_webhook", "arguments": { "url": "https://hooks.your-domain.com/logitland" } }
```

```json
{
  "delivery": {
    "kind": "webhook",
    "url_host": "hooks.your-domain.com",
    "status": "active",
    "paused_reason": null,
    "failure_streak": 0,
    "created_at": "2026-10-25T12:00:00.000Z"
  },
  "secret": "whsec_example"
}
```

The secret appears once.
URL, DNS, and challenge refusals produce `destination_refused` tool errors.
Source: [tool](https://github.com/logitland/logitland/blob/main/packages/relay/src/mcp/tools.ts#L169).
