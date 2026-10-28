---
title: Configure heartbeat ACKs
description: Set whether the fake gateway acknowledges heartbeats.
operation:
  method: POST
  path: /_fake/gateway/heartbeats
  server: http://127.0.0.1:8790
  auth: none
  requestBody:
    schema:
      type: object
      properties:
        ack:
          type: boolean
    example:
      ack: false
  responses:
    '200':
      description: Returns the configured ACK setting.
      example:
        ack: false
    '400':
      description: Invalid input or world error.
source:
  - label: heartbeats
    href: https://github.com/logitland/logitland/blob/main/packages/discord-fake/src/control.ts#L367
---

ACKs remain enabled unless `ack` is exactly `false`.
