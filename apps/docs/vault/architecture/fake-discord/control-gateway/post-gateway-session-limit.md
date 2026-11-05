---
title: Configure session start limit
description: Update the remaining session starts and reset time.
operation:
  method: POST
  path: /_fake/gateway/session-limit
  server: http://127.0.0.1:8790
  auth: none
  requestBody:
    schema:
      type: object
      properties:
        remaining:
          type: number
          description: Session starts remaining; initially 1000. Successful IDENTIFY decrements this value.
        reset_after_ms:
          type: number
          description: Set resetAt to the current clock plus this many milliseconds.
    example:
      remaining: 0
      reset_after_ms: 1000
  responses:
    '200':
      contentType: application/json
      description: Returns `{total,remaining,resetAt,maxConcurrency}`; `resetAt` is epoch milliseconds.
    '400':
      description: Invalid JSON, body shape, or nonnumeric field value.
source:
  - label: session limit
    href: https://github.com/logitland/logitland/blob/main/packages/discord-fake/src/control.ts#L421-L431
  - label: initial session limit
    href: https://github.com/logitland/logitland/blob/main/packages/discord-fake/src/gateway.ts#L173-L183
  - label: IDENTIFY limit enforcement
    href: https://github.com/logitland/logitland/blob/main/packages/discord-fake/src/gateway.ts#L434-L436
---

The initial limit has `total: 1000`, `remaining: 1000`, and `maxConcurrency: 1`; `resetAt` starts one day after startup. This endpoint changes only `remaining` and `resetAt`, not `total` or `maxConcurrency`. The fake does not automatically refill remaining sessions when the reset time passes.

Omitted or `null` fields stay unchanged. Values are checked for numeric type, without integer or range checks. If `remaining` is valid but `reset_after_ms` is invalid, the request returns `400` after changing `remaining`.
