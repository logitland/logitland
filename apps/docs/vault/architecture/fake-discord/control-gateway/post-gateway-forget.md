---
title: Forget gateway sessions
description: Mark all gateway sessions expired.
operation:
  method: POST
  path: /_fake/gateway/forget
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
  - label: forget
    href: https://github.com/logitland/logitland/blob/main/packages/discord-fake/src/control.ts#L385
---

Their next RESUME gets opcode `9`, `d: false`.
