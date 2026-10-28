---
title: Get Gateway bot limits
description: Return the Gateway URL and bot session start limit.
operation:
  method: GET
  path: /api/v10/gateway/bot
  server: http://127.0.0.1:8790
  parameters:
    - name: Authorization
      in: header
      required: true
      type: string
      description: The fake bot token.
      example: Bot fake-local
  responses:
    '200':
      description: The Gateway URL, shard count, and session start limit.
      example:
        url: ws://127.0.0.1:8790/gateway
        shards: 1
        session_start_limit:
          total: 1000
          remaining: 1000
          reset_after: 86400000
          max_concurrency: 1
    '401':
      description: Missing or wrong bot token (`0`).
source:
  - label: gateway.bot
    href: https://github.com/logitland/logitland/blob/main/packages/discord-fake/src/rest.ts#L208
  - label: session limit defaults
    href: https://github.com/logitland/logitland/blob/main/packages/discord-fake/src/gateway.ts#L171
---

Route name `gateway.bot`. The limit contains `total`, `remaining`, `reset_after` in milliseconds, and `max_concurrency`.
The fake starts with 1,000 total and remaining sessions and concurrency one.

`reset_after` counts down from one day after startup and never drops below `0`.
Each successful IDENTIFY decrements `remaining`. The fake does not refill it automatically.
[`POST /_fake/gateway/session-limit`](../control-gateway/post-gateway-session-limit.md) changes it.

- [Shared REST rules](../index.md#rest-authentication-and-responses) cover rate-limit headers and injected failures.
