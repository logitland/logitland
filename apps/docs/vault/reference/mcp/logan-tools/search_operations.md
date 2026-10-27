---
title: Find a Discord operation
description: Search the Discord operations you may have Logan perform in this server right now, best match first.
operation:
  protocol: mcp
  kind: tool
  name: search_operations
  endpoint: /mcp/admin
  auth:
    scheme: bearer
    description: A person's lla_ token.
  examples:
    - title: Delete channel
      arguments:
        query: delete_channel
        method: DELETE
        family: channel
      result:
        structuredContent:
          operations:
            - operation_id: delete_channel
              method: DELETE
              path: /channels/{channel_id}
              family: channel
              risk: destructive
              needs_confirmation: true
  inputSchema:
    type: object
    properties:
      query:
        description: What you want to do, in plain words ("kick a member", "create forum tag"), or an operation ID.
        type: string
        maxLength: 200
      method:
        type: string
        enum:
          - GET
          - POST
          - PUT
          - PATCH
          - DELETE
      family:
        description: 'Narrow to one family: channel, message, thread, member, role, guild, moderation…'
        type: string
        maxLength: 40
      cursor:
        description: next_cursor from the previous page.
        type: string
        maxLength: 10
  annotations:
    readOnlyHint: true
    openWorldHint: false
source:
  - label: schema
    href: https://github.com/logitland/logitland/blob/main/packages/relay/src/mcp/logan-tools.ts#L16
  - label: search handler
    href: https://github.com/logitland/logitland/blob/main/packages/relay/src/mcp/logan-tools.ts#L71
  - label: catalog search
    href: https://github.com/logitland/logitland/blob/main/packages/relay/src/services/logan/catalog.ts
---

Plain-language search and exact operation IDs both work.
Results sort by relevance, then operation ID.
An empty query lists matching available operations.

`family` must match exactly. Without `cursor`, the list starts at offset 0.

Common families include `channel`, `message`, `thread`, `member`, `role`, `guild`, and `moderation`.
Each page contains at most twenty operations.
Pass `next_cursor` as `cursor` to continue.
Omitted `next_cursor` means the last page.
The implementation parses the cursor as a numeric offset; use only values it returns.

A result is not permission to execute against every target.
Search checks base grants across the server's known channels.
Execution checks the specific target, body-dependent requirements, and role hierarchy.
No matches return an empty operations array.
Invalid argument types or lengths become `invalid_request` tool errors.
