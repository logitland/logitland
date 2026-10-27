---
title: Logan admin tools
description: Search, describe, execute, and track permission-checked Discord catalog operations through Logan.
order: 2
---

[MCP reference](../index.md) · [Logan OAuth](../../public-api/transports/index.md)

Logan exposes exactly four MCP tools.
The Discord catalog supplies operation definitions, not thousands of individual MCP tools.
Use `search_operations`, then `describe_operation`, then `call_operation`.
Use `request_status` when a destructive operation needs confirmation.

Authenticate at `POST /mcp/admin` with the person's `lla_` token.
The person must remain in the configured Discord server and hold the relay's `logan` permission.
The server reloads membership and standing on every HTTP request.
The limit is sixty MCP requests per person per minute.
The person's Discord permissions still determine each operation's availability.
Full relay admin standing does not substitute for Discord permissions.

The examples below show `tools/call` `params` and resulting `structuredContent`.
Each result also contains the same JSON string in `content[0].text`.
IDs and timestamps are illustrative.

Sources: [four tool registrations](https://github.com/logitland/logitland/blob/main/packages/relay/src/mcp/logan-tools.ts#L57),
[route authentication and limit](https://github.com/logitland/logitland/blob/main/packages/relay/src/routes/logan.ts#L98),
[caller loading](https://github.com/logitland/logitland/blob/main/packages/relay/src/services/logan/access.ts#L70).

## search_operations

[Open the focused reference](./search_operations.md).

## describe_operation

[Open the focused reference](./describe_operation.md).

## call_operation

[Open the focused reference](./call_operation.md).

## request_status

[Open the focused reference](./request_status.md).

## Catalog boundaries

Logan offers an operation only when it accepts bot authentication,
targets a guild or channel, has a known permission rule, and accepts JSON if a body exists.
Credential operations and paths containing `@me` are excluded.
This also excludes direct account access and multipart-only operations.

Permissions include channel overwrites, timeouts, conditional body requirements, and role/member hierarchy.
A private thread needs the person's `ViewChannel` and `ManageThreads` permissions.
Unknown permission conditions are treated as requiring the associated permission.
A grant the relay cannot verify does not authorize execution.
Discord still enforces Logan's own bot permissions afterward.

The catalog comes from the published `@mia-cx/discord-catalog` package in `mia-cx/discord-mcp`.
Availability changes with the person's roles, the target, and the catalog version.
Use live search and description instead of assuming an operation exists or is allowed.

Sources: [offered operations](https://github.com/logitland/logitland/blob/main/packages/relay/src/services/logan/access.ts#L133),
[target and conditional checks](https://github.com/logitland/logitland/blob/main/packages/relay/src/services/logan/access.ts#L203),
[catalog adapter](https://github.com/logitland/logitland/blob/main/packages/relay/src/services/logan/catalog.ts#L1).

## Tool error example

```json
{
  "content": [{ "type": "text", "text": "{\"error\":\"not_found\",\"detail\":\"No such request of yours.\"}" }],
  "structuredContent": { "error": "not_found", "detail": "No such request of yours." },
  "isError": true
}
```

Schema errors can also add `errors` with field paths and messages.
Authentication, origin, and request-rate failures occur before the tools and use HTTP problem responses.
Source: [tool error conversion](https://github.com/logitland/logitland/blob/main/packages/relay/src/mcp/logan-tools.ts#L35).
