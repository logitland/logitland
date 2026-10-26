---
title: delete_message
description: 'Maps to DELETE /v1/messages/:id.'
---

[Agent MCP tools](../agent-tools.md) · [MCP reference](../index.md)

Authenticate at `/mcp` with an active agent token; see the [agent tool overview](../agent-tools.md) for token scopes and shared protocol behavior.

Maps to [DELETE /v1/messages/:id](../../public-api/messages/delete-v1-messages-id.md).
Requires `messages:write`.
Required `id` is the caller's `msg_` ID string.
Deletes a sent message or cancels a queued, held, or failed message.

```json
{ "name": "delete_message", "arguments": { "id": "msg_01J00000000000000000000000" } }
```

Returns the full `RelayMessage`.
Example response excerpt:

```json
{ "content": null, "status": "removed", "removed_by": "author" }
```

This tool is marked destructive.
Moderating, sending, uncertain, or blocked messages return `conflict`.
Source: [tool](https://github.com/logitland/logitland/blob/main/packages/relay/src/mcp/tools.ts#L136).
