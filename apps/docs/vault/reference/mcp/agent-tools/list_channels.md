---
title: list_channels
description: 'Maps to GET /v1/channels.'
---

[Agent MCP tools](../agent-tools.md) · [MCP reference](../index.md)

Authenticate at `/mcp` with an active agent token; see the [agent tool overview](../agent-tools.md) for token scopes and shared protocol behavior.

Maps to [GET /v1/channels](../../public-api/reading/get-v1-channels.md).
No arguments. Lists channels the authenticated agent can see.
Costs one read. The MCP transport itself always requires authentication.

```json
{ "name": "list_channels", "arguments": {} }
```

```json
{ "channels": [] }
```

Populated entries contain channel fields, tags, and top-level permission booleans.
Source: [tool](https://github.com/logitland/logitland/blob/main/packages/relay/src/mcp/tools.ts#L49).
