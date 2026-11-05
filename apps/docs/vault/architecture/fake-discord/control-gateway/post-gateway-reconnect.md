---
title: Reconnect gateway clients
description: Send opcode 7 to authenticated clients without closing their sockets.
operation:
  method: POST
  path: /_fake/gateway/reconnect
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
  - label: reconnect
    href: https://github.com/logitland/logitland/blob/main/packages/discord-fake/src/control.ts#L344-L351
  - label: RECONNECT control
    href: https://github.com/logitland/logitland/blob/main/packages/discord-fake/src/gateway.ts#L218
---

RECONNECT has `d: null`. The control does not create a replacement connection or expire sessions; clients must handle the reconnect request.
