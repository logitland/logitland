---
title: Describe a Discord operation
description: What one operation takes (path and query parameters, body), what Discord requires of you for it, and whether it waits for a Confirm.
order: 4
operation:
  protocol: mcp
  kind: tool
  name: describe_operation
  endpoint: /mcp/admin
  auth:
    scheme: bearer
    description: A person's lla_ token.
  examples:
    - title: Delete channel (excerpt)
      arguments:
        operation_id: delete_channel
      result:
        structuredContent:
          operation_id: delete_channel
          method: DELETE
          path: /channels/{channel_id}
          family: channel
          risk: destructive
          needs_confirmation: true
          path_params:
            - channel_id
          query_params: []
          required_query: []
          body: null
          offered: true
          available_to_you: true
  inputSchema:
    type: object
    properties:
      operation_id:
        type: string
        maxLength: 100
    required:
      - operation_id
  annotations:
    readOnlyHint: true
    openWorldHint: false
source:
  - label: schema
    href: https://github.com/logitland/logitland/blob/main/packages/relay/src/mcp/logan-tools.ts#L22
  - label: describe handler
    href: https://github.com/logitland/logitland/blob/main/packages/relay/src/mcp/logan-tools.ts#L86
  - label: permission checks
    href: https://github.com/logitland/logitland/blob/main/packages/relay/src/services/logan/access.ts
---

Required `operation_id` is a string of at most 100 characters.
Descriptions can include an operation the person cannot execute, with `offered` or `available_to_you` false.
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
