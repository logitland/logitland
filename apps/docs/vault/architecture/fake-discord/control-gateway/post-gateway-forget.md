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
      description: Malformed JSON request body.
source:
  - label: forget
    href: https://github.com/logitland/logitland/blob/main/packages/discord-fake/src/control.ts#L394-L401
  - label: expire sessions
    href: https://github.com/logitland/logitland/blob/main/packages/discord-fake/src/gateway.ts#L244
---

Marks connected and disconnected sessions expired without closing sockets or removing their inspection records. A later RESUME for an expired session receives opcode `9`, `d: false`, under normal resume handling; a [next-resume override](post-gateway-next-resume.md) can take precedence.
