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
        reset_after_ms:
          type: number
    example:
      remaining: 0
      reset_after_ms: 1000
  responses:
    '200':
      contentType: application/json
      description: Returns `{total,remaining,resetAt,maxConcurrency}`; `resetAt` is epoch milliseconds.
    '400':
      description: Invalid input or world error.
source:
  - label: session limit
    href: https://github.com/logitland/logitland/blob/main/packages/discord-fake/src/control.ts#L412
---

`reset_after_ms` sets `resetAt` relative to the current clock. Omitted fields stay unchanged. The fake does not automatically refill remaining sessions.
