---
title: Logan admin MCP tools
description: Search, describe, execute, and track permission-checked Discord catalog operations through Logan.
---

[MCP reference](index.md) · [Logan OAuth](../public-api/transports.md)

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

Finds operations the person might perform somewhere in the server.
Plain-language search and exact operation IDs both work.
Results sort by relevance, then operation ID.
An empty query lists matching available operations.

| Argument | Type and default                                             |
| -------- | ------------------------------------------------------------ |
| `query`  | Optional string, at most 200 characters                      |
| `method` | Optional `GET`, `POST`, `PUT`, `PATCH`, or `DELETE`          |
| `family` | Optional string, at most 40 characters; exact family match   |
| `cursor` | Optional string, at most 10 characters; default offset `"0"` |

Common families include `channel`, `message`, `thread`, `member`, `role`, `guild`, and `moderation`.
Each page contains at most twenty operations.
Pass `next_cursor` as `cursor` to continue.
Omitted `next_cursor` means the last page.
The implementation parses the cursor as a numeric offset; use only values it returns.

```json
{ "name": "search_operations", "arguments": { "query": "delete_channel", "method": "DELETE", "family": "channel" } }
```

Example response for a caller whose permissions permit the search result:

```json
{
  "operations": [
    {
      "operation_id": "delete_channel",
      "method": "DELETE",
      "path": "/channels/{channel_id}",
      "family": "channel",
      "risk": "destructive",
      "needs_confirmation": true
    }
  ]
}
```

A result is not permission to execute against every target.
Search checks base grants across the server's known channels.
Execution checks the specific target, body-dependent requirements, and role hierarchy.
No matches return `{"operations":[]}`.
Invalid argument types or lengths become `invalid_request` tool errors.

Sources: [schema](https://github.com/logitland/logitland/blob/main/packages/relay/src/mcp/logan-tools.ts#L16),
[search handler](https://github.com/logitland/logitland/blob/main/packages/relay/src/mcp/logan-tools.ts#L71),
[search ranking](https://github.com/logitland/logitland/blob/main/packages/discord-catalog/src/index.ts#L48).

## describe_operation

Returns one catalog operation's input metadata and permission requirements.
Required `operation_id` is a string of at most 100 characters.
Descriptions can include an operation the person cannot execute, with `offered` or `available_to_you` false.

```json
{ "name": "describe_operation", "arguments": { "operation_id": "delete_channel" } }
```

Example response excerpt for an eligible caller:

```json
{
  "operation_id": "delete_channel",
  "method": "DELETE",
  "path": "/channels/{channel_id}",
  "family": "channel",
  "risk": "destructive",
  "needs_confirmation": true,
  "path_params": ["channel_id"],
  "query_params": [],
  "required_query": [],
  "body": null,
  "offered": true,
  "available_to_you": true
}
```

The full result also contains `required_permissions`, the catalog's permission rule object.
It states base alternatives, conditional requirements, and hierarchy rules where applicable.
`body` is null when the operation accepts none.
Otherwise it contains `required` and `schema`, with a schema name or null.
It does not return a complete Discord JSON schema.
`path_params` lists required path names.
`query_params` lists accepted query names.
`required_query` identifies required query entries.
Consult the operation's Discord schema documentation for field-level body types.

`update_guild_member` also returns a `note` explaining timeout confirmation.
`needs_confirmation` reflects the catalog's destructive risk.
A non-null `communication_disabled_until` timeout still requires confirmation even when that flag is false.

Unknown operation IDs return a `not_found` tool error.
Sources: [schema](https://github.com/logitland/logitland/blob/main/packages/relay/src/mcp/logan-tools.ts#L22),
[describe handler](https://github.com/logitland/logitland/blob/main/packages/relay/src/mcp/logan-tools.ts#L86),
[delete-channel permission definition](https://github.com/logitland/logitland/blob/main/packages/discord-catalog/src/vendor/catalog/required-permissions.ts#L427).

## call_operation

Runs a catalog operation as Logan, subject to the person's current permissions.
Reads and ordinary writes execute immediately.
Destructive operations wait for the requesting person's confirmation in Discord.
No generic tool exists to bypass confirmation.

| Argument       | Type and default                                                         |
| -------------- | ------------------------------------------------------------------------ |
| `operation_id` | Required string, at most 100 characters                                  |
| `params`       | Optional map of path names to strings; default `{}`                      |
| `query`        | Optional map of names to string, number, or boolean values; default `{}` |
| `body`         | Optional JSON value matching the selected operation                      |
| `reason`       | Optional string, at most 200 characters; trimmed before use              |

If the operation takes `guild_id`, Logan fills it with the configured guild when omitted.
Other required path parameters must be present.
Names ending in `_id` require Discord snowflake strings.
Unknown query names and missing required query fields return `invalid_request`.
A forbidden body, or missing required body, also returns `invalid_request`.
Discord validates operation-specific body fields.
The relay checks permission-sensitive body fields before dispatch.

Example read:

```json
{ "name": "call_operation", "arguments": { "operation_id": "list_guild_channels" } }
```

Example response in a server with no channels visible to the caller:

```json
{ "status": "done", "operation_id": "list_guild_channels", "answer": [] }
```

`answer` contains Discord's response, filtered where needed.
A Discord no-content response becomes null.
The relay filters `list_guild_channels`, `get_active_guild_threads`, and `guild_search` results to the caller's channel access.

Example destructive call:

```json
{
  "name": "call_operation",
  "arguments": { "operation_id": "delete_channel", "params": { "channel_id": "123456789012345678" }, "reason": "Remove the unused test channel." }
}
```

```json
{
  "status": "pending",
  "request_id": "lgr_01J00000000000000000000000",
  "operation_id": "delete_channel",
  "expires_at": "2026-10-25T12:10:00.000Z",
  "detail": "Press Confirm on Logan’s message in the staff alerts channel within 10 minutes. Check back with request_status."
}
```

Destructive operations include catalog-classified deletes, kicks, bans, and bulk changes.
Setting non-null `communication_disabled_until` through `update_guild_member` also needs confirmation.
The requesting person must press Confirm within ten minutes.
No configured staff alerts channel produces `forbidden`.
Failure to post the confirmation produces `unavailable`.
Only the requester can confirm or cancel.
Confirmation rechecks permissions before execution.
See [Discord interaction buttons](../public-api/interactions.md#logan-confirmation-buttons).

Each write that runs enters the relay audit log.
Supported Discord operations receive an audit reason naming the person.
The staff alerts channel receives a write notice when configured.
A failed notice does not undo an executed action.

Missing operation IDs return `invalid_request`.
Excluded operations, wrong guilds, inaccessible targets, missing permissions, and hierarchy violations return `forbidden`.
Discord refusals map to `invalid_request`, `forbidden`, or `not_found`.
Discord throttling maps to `rate_limited`.
A lost connection or Discord server failure maps to `unavailable`.
These are `isError: true` tool results.

Sources: [tool schema](https://github.com/logitland/logitland/blob/main/packages/relay/src/mcp/logan-tools.ts#L23),
[tool handler](https://github.com/logitland/logitland/blob/main/packages/relay/src/mcp/logan-tools.ts#L109),
[request checks](https://github.com/logitland/logitland/blob/main/packages/relay/src/services/logan/access.ts#L378),
[execution and confirmation](https://github.com/logitland/logitland/blob/main/packages/relay/src/services/logan/calls.ts#L97),
[result filtering](https://github.com/logitland/logitland/blob/main/packages/relay/src/services/logan/access.ts#L471).

## request_status

Reads a confirmation request created by the same person.
Required `request_id` is a string of at most 40 characters.
There are no pagination or optional arguments.

```json
{ "name": "request_status", "arguments": { "request_id": "lgr_01J00000000000000000000000" } }
```

Example after a confirmed delete returned no content:

```json
{
  "request_id": "lgr_01J00000000000000000000000",
  "operation_id": "delete_channel",
  "status": "done",
  "created_at": "2026-10-25T12:00:00.000Z",
  "expires_at": "2026-10-25T12:10:00.000Z",
  "decided_at": "2026-10-25T12:01:00.000Z",
  "answer": null
}
```

Possible statuses are `pending`, `running`, `done`, `failed`, `cancelled`, and `expired`.
`decided_at` is null before a decision.
A successful completed request adds `answer`.
A failed execution adds `error` with its explanation.
A pending request past its deadline reads as `expired`.
Missing requests and another person's requests both return `not_found`.
Expired records become eligible for pruning a day after expiry.

Sources: [tool](https://github.com/logitland/logitland/blob/main/packages/relay/src/mcp/logan-tools.ts#L118),
[status projection](https://github.com/logitland/logitland/blob/main/packages/relay/src/services/logan/calls.ts#L174),
[result storage](https://github.com/logitland/logitland/blob/main/packages/relay/src/services/logan/calls.ts#L241),
[pruning](https://github.com/logitland/logitland/blob/main/packages/relay/src/services/logan/oauth.ts#L269).

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

The catalog comes from `@logitland/discord-catalog`, vendored from `mia-cx/discord-mcp`.
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
