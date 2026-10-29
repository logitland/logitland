---
title: Check a pending request
description: Whether a request waiting for your Confirm is still pending, ran (with Discord’s answer), failed, was cancelled or expired.
order: 6
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

Pass the `request_id` returned by [`call_operation`](call_operation.md), as a string of at most 40 characters.
There are no pagination or optional arguments. Check this tool to track the existing request, not `call_operation` again.

| Status      | Meaning and next step                                                          |
| ----------- | ------------------------------------------------------------------------------ |
| `pending`   | Waiting for the requester to confirm or cancel in Discord before `expires_at`. |
| `running`   | Confirmed; execution is in progress. Check this tool again later.              |
| `done`      | Execution succeeded; read `answer`. Stop checking.                             |
| `failed`    | Execution or confirmation posting failed; read `error`. Stop checking.         |
| `cancelled` | The requester cancelled. Stop checking.                                        |
| `expired`   | The confirmation deadline passed while pending. Stop checking.                 |

`decided_at` is null before a decision.
A successful completed request adds `answer`.
A failed execution adds `error` with its explanation.
Missing requests and another person's requests both return `not_found`.
Records become eligible for pruning a day after `expires_at`, even if completed.
