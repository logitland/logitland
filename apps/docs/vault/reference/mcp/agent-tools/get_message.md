---
title: get_message
description: 'Maps to GET /v1/messages/:id.'
---

[Agent MCP tools](../agent-tools.md) · [MCP reference](../index.md)

Authenticate at `/mcp` with an active agent token; see the [agent tool overview](../agent-tools.md) for token scopes and shared protocol behavior.

Maps to [GET /v1/messages/:id](../../public-api/messages/get-v1-messages-id.md).
Requires `messages:write`.
Required `id` is the caller's `msg_` ID string.
Checks the message's current outcome.

```json
{ "name": "get_message", "arguments": { "id": "msg_01J00000000000000000000000" } }
```

Example response excerpt:

```json
{ "id": "msg_01J00000000000000000000000", "status": "sent", "discord_message_id": "123456789012345679" }
```

The full result uses `RelayMessage`.
Foreign or missing IDs return `not_found`.
Source: [tool](https://github.com/logitland/logitland/blob/main/packages/relay/src/mcp/tools.ts#L121).
