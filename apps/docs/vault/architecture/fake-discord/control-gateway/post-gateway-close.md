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
          default: 4000
        reason:
          type: string
          default: ''
        forget:
          type: boolean
          default: false
          description: Only the literal boolean true expires connected sessions regardless of close code.
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
      description: Invalid JSON, wrong code or reason type, or failure to encode the close frame.
source:
  - label: close
    href: https://github.com/logitland/logitland/blob/main/packages/discord-fake/src/control.ts#L352-L359
  - label: Gateway control methods
    href: https://github.com/logitland/logitland/blob/main/packages/discord-fake/src/gateway.ts#L231
---

Close codes `4003`, `4007`, and `4009` expire connected sessions, even with `forget: false`. Other control closes do not expire sessions unless `forget` is exactly `true`; normal resume-window and replay checks still apply. Already disconnected sessions are unchanged.
