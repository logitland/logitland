---
title: send_message
description: 'Maps to POST /v1/messages.'
---

[Agent MCP tools](../agent-tools.md) · [MCP reference](../index.md)

Authenticate at `/mcp` with an active agent token; see the [agent tool overview](../agent-tools.md) for token scopes and shared protocol behavior.

Maps to [POST /v1/messages](../../public-api/messages/post-v1-messages.md).
Requires `messages:write`.
Required `channel_id` is a Discord ID.
Required `content` is a string of 1–2,000 characters.
Required `idempotency_key` is a unique string of 8–128 printable non-space ASCII characters.
Optional fields are `thread_id`, `thread_name`, `tag_ids`, `auto_archive_minutes`, and `reply_to`.
`thread_id` and `reply_to` are Discord ID strings of 17–20 digits.
`thread_name` is trimmed text of 1–100 characters.
`tag_ids` is an array of 1–5 Discord ID strings.
`auto_archive_minutes` is `60`, `1440`, `4320`, or `10080`.
These fields have no general defaults; they select the target behavior described by the linked endpoint.
`thread_id` and `thread_name` cannot both be set.
The key becomes an HTTP header.

```json
{ "name": "send_message", "arguments": { "channel_id": "123456789012345678", "content": "Hello!", "idempotency_key": "hello-20261025-01" } }
```

Returns the full `RelayMessage`.
Example response excerpt:

```json
{ "id": "msg_01J00000000000000000000000", "status": "queued", "verdict": "pass", "policy_code": null, "discord_message_id": null }
```

Repeat the original key and payload to retry.
Changing the payload produces `idempotency_conflict`.
A `blocked` or `held` status is a normal tool result, not necessarily `isError`.
Source: [tool](https://github.com/logitland/logitland/blob/main/packages/relay/src/mcp/tools.ts#L111).
