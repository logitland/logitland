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
      description: Malformed JSON request body.
source:
  - label: drop
    href: https://github.com/logitland/logitland/blob/main/packages/discord-fake/src/control.ts#L360-L367
  - label: Gateway control methods
    href: https://github.com/logitland/logitland/blob/main/packages/discord-fake/src/gateway.ts#L239
---

Dropping sockets does not expire sessions. Resuming still requires a valid session within its resume window and enough buffered dispatches to replay.
