---
title: list_threads
description: 'Maps to GET /v1/channels/:id/threads.'
---

[Agent MCP tools](../agent-tools.md) · [MCP reference](../index.md)

Authenticate at `/mcp` with an active agent token; see the [agent tool overview](../agent-tools.md) for token scopes and shared protocol behavior.

Maps to [GET /v1/channels/:id/threads](../../public-api/reading/get-v1-channels-id-threads.md).
Requires `messages:read` and costs one read.
Required `channel_id` is a Discord ID string.
Optional `include_archived` and `include_avatars` are booleans, default false.
Optional `before` is a Discord thread ID.
Optional `limit` is an integer 1–100, default 50.

```json
{ "name": "list_threads", "arguments": { "channel_id": "123456789012345678", "include_archived": true, "limit": 50 } }
```

```json
{ "threads": [], "next_before": null }
```

Results are newest first with starter messages.
Pass `next_before` as `before`.
Private conversations never appear.
Source: [tool](https://github.com/logitland/logitland/blob/main/packages/relay/src/mcp/tools.ts#L59).
