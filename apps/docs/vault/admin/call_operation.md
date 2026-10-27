---
title: Have Logan perform an operation
description: 'Logan performs one Discord operation in this server, if you may. Destructive ones (deletes, kicks, bans, timeouts, bulk changes) answer status pending: you confirm them on Logan’s message in the staff alerts channel.'
order: 5
operation:
  protocol: mcp
  kind: tool
  name: call_operation
  endpoint: /mcp/admin
  auth:
    scheme: bearer
    description: A person's lla_ token.
  examples:
    - title: Read operation
      arguments:
        operation_id: list_guild_channels
      result:
        structuredContent:
          status: done
          operation_id: list_guild_channels
          answer: []
    - title: Destructive operation
      arguments:
        operation_id: delete_channel
        params:
          channel_id: '123456789012345678'
        reason: Remove the unused test channel.
      result:
        structuredContent:
          status: pending
          request_id: lgr_01J00000000000000000000000
          operation_id: delete_channel
          expires_at: 2026-10-25T12:10:00.000Z
          detail: Press Confirm on Logan’s message in the staff alerts channel within 10 minutes. Check back with request_status.
  inputSchema:
    type: object
    properties:
      operation_id:
        type: string
        maxLength: 100
      params:
        description: 'Path parameters by name, e.g. { "channel_id": "…" }. guild_id is this server’s.'
        type: object
        propertyNames:
          type: string
        additionalProperties:
          type: string
      query:
        type: object
        propertyNames:
          type: string
        additionalProperties:
          type:
            - string
            - number
            - boolean
      body:
        description: The JSON body Discord takes for this operation.
      reason:
        description: 'Why: shown with a confirmation and kept in the audit logs.'
        type: string
        maxLength: 200
    required:
      - operation_id
  annotations:
    readOnlyHint: false
    destructiveHint: true
    openWorldHint: false
source:
  - label: tool schema
    href: https://github.com/logitland/logitland/blob/main/packages/relay/src/mcp/logan-tools.ts#L23
  - label: tool handler
    href: https://github.com/logitland/logitland/blob/main/packages/relay/src/mcp/logan-tools.ts#L109
  - label: request checks
    href: https://github.com/logitland/logitland/blob/main/packages/relay/src/services/logan/access.ts#L378
  - label: execution and confirmation
    href: https://github.com/logitland/logitland/blob/main/packages/relay/src/services/logan/calls.ts#L97
  - label: result filtering
    href: https://github.com/logitland/logitland/blob/main/packages/relay/src/services/logan/access.ts#L471
---

Reads and ordinary writes execute immediately.
Destructive operations wait for the requesting person's confirmation in Discord.
No generic tool exists to bypass confirmation.

`params` and `query` default to `{}`. `body` is a JSON value matching the selected operation. `reason` is trimmed
before use.

If the operation takes `guild_id`, Logan fills it with the configured guild when omitted.
Other required path parameters must be present.
Names ending in `_id` require Discord snowflake strings.
Unknown query names and missing required query fields return `invalid_request`.
A forbidden body, or missing required body, also returns `invalid_request`.
Discord validates operation-specific body fields.
The relay checks permission-sensitive body fields before dispatch.
`answer` contains Discord's response, filtered where needed.
A Discord no-content response becomes null.
The relay filters `list_guild_channels`, `get_active_guild_threads`, and `guild_search` results to the caller's channel access.

Destructive operations include catalog-classified deletes, kicks, bans, and bulk changes.
Setting non-null `communication_disabled_until` through `update_guild_member` also needs confirmation.
The requesting person must press Confirm within ten minutes.
No configured staff alerts channel produces `forbidden`.
Failure to post the confirmation produces `unavailable`.
Only the requester can confirm or cancel.
Confirmation rechecks permissions before execution.
See [Discord interaction buttons](../architecture/discord-interactions.md#logan-confirmation-buttons).

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
