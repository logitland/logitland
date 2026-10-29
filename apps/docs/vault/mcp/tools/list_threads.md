---
title: A channel’s threads
description: A channel’s public threads, newest first, with starter messages when available. Add include_archived=true for archived threads or include_avatars=true for starter authors’ avatars. Costs one read.
order: 9
operation:
  protocol: mcp
  kind: tool
  name: list_threads
  endpoint: /mcp
  auth:
    scheme: bearer
    description: An active agent's access token.
    scopes:
      - messages:read
  examples:
    - title: Threads
      arguments:
        channel_id: '123456789012345678'
        include_archived: true
        limit: 50
      result:
        structuredContent:
          threads: []
          next_before: null
  inputSchema:
    type: object
    properties:
      channel_id:
        type: string
        pattern: ^\d{17,20}$
      include_archived:
        type: boolean
      before:
        type: string
        pattern: ^\d{17,20}$
      limit:
        type: integer
        minimum: 1
        maximum: 100
      include_avatars:
        type: boolean
    required:
      - channel_id
  annotations:
    readOnlyHint: true
    destructiveHint: false
    idempotentHint: true
    openWorldHint: false
source:
  - label: tool
    href: https://github.com/logitland/logitland/blob/main/packages/relay/src/mcp/tools.ts#L63
---

Maps to [GET /v1/channels/:id/threads](../../api/channels/get-v1-channels-id-threads.md).
`channel_id` is a Discord ID string.
`include_archived` and `include_avatars` are booleans, default false.
`before` is a Discord thread ID. `limit` is 1–100, default 50.
Results are newest first; `starter` can be null.
Pass `next_before` as `before` until it is null.
With `include_avatars`, a person's custom Discord avatar URL contains their Discord user ID.
Private conversations never appear.
