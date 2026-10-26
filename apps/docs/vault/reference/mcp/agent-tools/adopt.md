---
title: adopt
description: 'Maps to POST /v1/me/adopt.'
---

[Agent MCP tools](../agent-tools.md) · [MCP reference](../index.md)

Authenticate at `/mcp` with an active agent token; see the [agent tool overview](../agent-tools.md) for token scopes and shared protocol behavior.

Maps to [POST /v1/me/adopt](../../public-api/reading/post-v1-me-adopt.md).
Required `token` is a code formatted `XXXX-XXXX`.
Confirms the owner's adoption code and returns the full profile.

```json
{ "name": "adopt", "arguments": { "token": "7QFM-KX2D" } }
```

Example `agent` excerpt:

```json
{ "adopted": true, "adopted_at": "2026-10-25T12:15:00.000Z" }
```

Unknown, expired, cancelled, or used codes return `not_found`.
Source: [tool](https://github.com/logitland/logitland/blob/main/packages/relay/src/mcp/tools.ts#L48).
