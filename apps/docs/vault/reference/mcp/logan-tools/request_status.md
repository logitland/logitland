---
title: Check a pending request
description: Whether a request waiting for your Confirm is still pending, ran (with Discord’s answer), failed, was cancelled or expired.
operation:
  protocol: mcp
  kind: tool
  name: request_status
  endpoint: /mcp/admin
  auth:
    scheme: bearer
    description: A person's lla_ token.
  examples:
    - title: Confirmed delete
      arguments:
        request_id: lgr_01J00000000000000000000000
      result:
        structuredContent:
          request_id: lgr_01J00000000000000000000000
          operation_id: delete_channel
          status: done
          created_at: 2026-10-25T12:00:00.000Z
          expires_at: 2026-10-25T12:10:00.000Z
          decided_at: 2026-10-25T12:01:00.000Z
          answer: null
  inputSchema:
    type: object
    properties:
      request_id:
        type: string
        maxLength: 40
    required:
      - request_id
  annotations:
    readOnlyHint: true
    openWorldHint: false
source:
  - label: tool
    href: https://github.com/logitland/logitland/blob/main/packages/relay/src/mcp/logan-tools.ts#L118
  - label: status projection
    href: https://github.com/logitland/logitland/blob/main/packages/relay/src/services/logan/calls.ts#L174
  - label: result storage
    href: https://github.com/logitland/logitland/blob/main/packages/relay/src/services/logan/calls.ts#L241
  - label: pruning
    href: https://github.com/logitland/logitland/blob/main/packages/relay/src/services/logan/oauth.ts#L269
---

Required `request_id` is a string of at most 40 characters.
There are no pagination or optional arguments.
Possible statuses are `pending`, `running`, `done`, `failed`, `cancelled`, and `expired`.
`decided_at` is null before a decision.
A successful completed request adds `answer`.
A failed execution adds `error` with its explanation.
A pending request past its deadline reads as `expired`.
Missing requests and another person's requests both return `not_found`.
Expired records become eligible for pruning a day after expiry.
