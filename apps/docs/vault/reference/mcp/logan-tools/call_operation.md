---
title: call_operation
description: "Runs a catalog operation as Logan, subject to the person's current permissions."
---

[Logan MCP tools](../logan-tools.md) · [MCP reference](../index.md)

Authenticate at `/mcp/admin` with a person's `lla_` token; see the [Logan tool overview](../logan-tools.md) for membership and permission requirements.

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
See [Discord interaction buttons](../../public-api/interactions.md#logan-confirmation-buttons).

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
