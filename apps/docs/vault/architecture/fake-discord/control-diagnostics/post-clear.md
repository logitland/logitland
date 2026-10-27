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
    href: https://github.com/logitland/logitland/blob/main/packages/discord-fake/src/fake.ts#L405
---

`messages` defaults to `false`. Setting it to `true` also clears stored messages and threads. Clearing logs does not reset request numbers, OAuth tokens, interactions, guilds, or Gateway sessions.
