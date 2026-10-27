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
    example:
      resumable: true
  responses:
    '200':
      description: The action succeeds even when no clients are connected.
      example:
        ok: true
    '400':
      description: Invalid input or world error.
source:
  - label: invalidate
    href: https://github.com/logitland/logitland/blob/main/packages/discord-fake/src/control.ts#L359
---

`resumable` defaults to `false`. It sends opcode `9` with that boolean to authenticated clients and keeps sockets open.
