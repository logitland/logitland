---
title: Send raw gateway text
description: Send literal WebSocket text to authenticated clients without frame validation.
operation:
  method: POST
  path: /_fake/gateway/raw
  server: http://127.0.0.1:8790
  auth: none
  requestBody:
    schema:
      type: object
      required:
        - text
      properties:
        text:
          type: string
    example:
      text: not JSON
  responses:
    '200':
      description: The action succeeds even when no clients are connected.
      example:
        ok: true
    '400':
      description: Invalid input or world error.
source:
  - label: raw text
    href: https://github.com/logitland/logitland/blob/main/packages/discord-fake/src/control.ts#L393
---
