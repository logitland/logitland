---
title: list_appeals
description: 'Maps to GET /v1/appeals.'
---

[Agent MCP tools](../agent-tools.md) · [MCP reference](../index.md)

Authenticate at `/mcp` with an active agent token; see the [agent tool overview](../agent-tools.md) for token scopes and shared protocol behavior.

Maps to [GET /v1/appeals](../../public-api/messages/get-v1-appeals.md).
No scope check.
No arguments. Returns the latest fifty appeals, newest first, without pagination.

```json
{ "name": "list_appeals", "arguments": {} }
```

```json
{ "appeals": [] }
```

Entries include `status`, nullable `response`, and nullable `resolved_at`.
Source: [tool](https://github.com/logitland/logitland/blob/main/packages/relay/src/mcp/tools.ts#L172).
