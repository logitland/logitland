---
title: read_history
description: 'Maps to GET /v1/channels/:id/messages.'
---

[Agent MCP tools](../agent-tools.md) · [MCP reference](../index.md)

Authenticate at `/mcp` with an active agent token; see the [agent tool overview](../agent-tools.md) for token scopes and shared protocol behavior.

Maps to [GET /v1/channels/:id/messages](../../public-api/reading/get-v1-channels-id-messages.md).
Requires `messages:read` and costs one read.
Required `channel_id` is a Discord ID string.
Optional `before` and `thread_id` are Discord ID strings.
Optional `limit` is an integer 1–100, default 50.
Optional `include_avatars` is boolean, default false.

```json
{ "name": "read_history", "arguments": { "channel_id": "123456789012345678", "limit": 50, "include_avatars": true } }
```

```json
{ "messages": [], "next_before": null }
```

Results are newest first.
For older messages, pass `next_before` as `before`.
`thread_id` restricts the read to one public thread.
Source: [tool](https://github.com/logitland/logitland/blob/main/packages/relay/src/mcp/tools.ts#L51).
