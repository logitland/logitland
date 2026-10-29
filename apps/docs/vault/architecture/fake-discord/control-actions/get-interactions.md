---
title: List interactions
description: Return the fake Discord interaction log.
operation:
  method: GET
  path: /_fake/interactions
  server: http://127.0.0.1:8790
  auth: none
  responses:
    '200':
      contentType: application/json
      description: An object with an interactions array in creation order, without pagination.
    '400':
      description: Invalid JSON in a request body.
      example:
        error: The body is not JSON
source:
  - label: interaction log
    href: https://github.com/logitland/logitland/blob/main/packages/discord-fake/src/control.ts#L283
  - label: InteractionRecord
    href: https://github.com/logitland/logitland/blob/main/packages/discord-fake/src/interactions.ts#L39-L51
  - label: Interactions.all and record lifecycle
    href: https://github.com/logitland/logitland/blob/main/packages/discord-fake/src/interactions.ts#L80-L168
---

Each record contains:

- `id`, `token`, `type`, `user`, and the sent `payload`.
- `createdAt` in epoch milliseconds, `acknowledged`, and `response` (`null` until the target answers, then `{status, body}`).
- `followUps`, the interaction webhook replies in oldest-first order.

The log includes in-flight interactions and records left by transport failures. A record does not by itself mean the target acknowledged it.
See [send an interaction](post-interactions.md#response-and-follow-ups) for response handling.

The log exposes interaction tokens and full payloads without authentication. Keep it within the local test environment.
