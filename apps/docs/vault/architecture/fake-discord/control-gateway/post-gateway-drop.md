---
title: Drop gateway sockets
description: Terminate all gateway sockets without sending close frames.
operation:
  method: POST
  path: /_fake/gateway/drop
  server: http://127.0.0.1:8790
  auth: none
  requestBody:
    example: {}
  responses:
    '200':
      description: The action succeeds even when no clients are connected.
      example:
        ok: true
    '400':
      description: Invalid input or world error.
source:
  - label: drop
    href: https://github.com/logitland/logitland/blob/main/packages/discord-fake/src/control.ts#L351
  - label: Gateway control methods
    href: https://github.com/logitland/logitland/blob/main/packages/discord-fake/src/gateway.ts#L216
---

Dropping sockets preserves sessions until their resume window expires.
