---
title: Send raw gateway text
description: Send literal WebSocket text to authenticated clients without Gateway JSON validation.
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
      description: Invalid JSON or missing or non-string text.
source:
  - label: raw text
    href: https://github.com/logitland/logitland/blob/main/packages/discord-fake/src/control.ts#L402-L409
  - label: raw text sending
    href: https://github.com/logitland/logitland/blob/main/packages/discord-fake/src/gateway.ts#L249
---

The text still uses normal WebSocket text framing. It bypasses the fake's structured frame log and does not advance session sequences or enter replay buffers.
