---
title: Clear fake state
description: Clear diagnostic logs, failure rules, and rate-limit buckets, optionally clearing messages and threads.
operation:
  method: POST
  path: /_fake/clear
  server: http://127.0.0.1:8790
  auth: none
  requestBody:
    schema:
      type: object
      properties:
        messages:
          type: boolean
          default: false
    example:
      messages: true
  responses:
    '200':
      description: The diagnostic state was cleared.
      example:
        ok: true
    '400':
      description: Invalid input or a world error.
      example:
        error: message
source:
  - label: clear
    href: https://github.com/logitland/logitland/blob/main/packages/discord-fake/src/control.ts#L110
  - label: reset
    href: https://github.com/logitland/logitland/blob/main/packages/discord-fake/src/fake.ts#L443-L449
  - label: message and thread cleanup
    href: https://github.com/logitland/logitland/blob/main/packages/discord-fake/src/world.ts#L685-L692
---

Always clears the request log, Gateway frame log, failure rules, and rate-limit bucket counts. Rate-limit settings remain unchanged.

Setting `messages` to `true` also clears stored messages and threads. This is not a full world reset: request numbers, OAuth tokens,
interaction records, guilds, and Gateway sessions remain.
