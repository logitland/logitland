---
title: Invalidate gateway sessions
description: Send opcode 9 with a resumable flag to authenticated clients while keeping sockets open.
operation:
  method: POST
  path: /_fake/gateway/invalidate
  server: http://127.0.0.1:8790
  auth: none
  requestBody:
    schema:
      type: object
      properties:
        resumable:
          type: boolean
          default: false
          description: Sends true only when this field is exactly the boolean true; other values send false.
    example:
      resumable: true
  responses:
    '200':
      description: The action succeeds even when no clients are connected.
      example:
        ok: true
    '400':
      description: Malformed JSON or an unreadable request body.
source:
  - label: invalidate
    href: https://github.com/logitland/logitland/blob/main/packages/discord-fake/src/control.ts#L368-L375
  - label: INVALID_SESSION control
    href: https://github.com/logitland/logitland/blob/main/packages/discord-fake/src/gateway.ts#L223
---

This control only sends the INVALID_SESSION frame. It does not expire sessions or detach them from their open sockets, even when `resumable` is `false`. Use [forget](post-gateway-forget.md) to expire sessions.
