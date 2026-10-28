---
title: Close gateway sockets
description: Close all gateway sockets with the specified code and reason.
operation:
  method: POST
  path: /_fake/gateway/close
  server: http://127.0.0.1:8790
  auth: none
  requestBody:
    schema:
      type: object
      properties:
        code:
          type: number
        reason:
          type: string
        forget:
          type: boolean
    example:
      code: 4009
      reason: Test timeout
      forget: true
  responses:
    '200':
      description: The action succeeds even when no clients are connected.
      example:
        ok: true
    '400':
      description: Invalid input or world error.
source:
  - label: close
    href: https://github.com/logitland/logitland/blob/main/packages/discord-fake/src/control.ts#L343
  - label: Gateway control methods
    href: https://github.com/logitland/logitland/blob/main/packages/discord-fake/src/gateway.ts#L216
---

`code` defaults to `4000`, `reason` to `""`, and `forget` to `false`. Close codes `4003`, `4007`, and `4009` expire sessions, even with `forget: false`. Other control closes preserve resumability unless `forget: true`.
