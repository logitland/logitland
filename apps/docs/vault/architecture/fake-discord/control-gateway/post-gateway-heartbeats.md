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
          default: true
          description: Each call enables ACKs unless ack is exactly false, including when ack is omitted.
    example:
      ack: false
  responses:
    '200':
      description: Returns the configured ACK setting.
      example:
        ack: false
    '400':
      description: Malformed JSON or an unreadable request body.
source:
  - label: heartbeats
    href: https://github.com/logitland/logitland/blob/main/packages/discord-fake/src/control.ts#L376-L383
  - label: heartbeat handling
    href: https://github.com/logitland/logitland/blob/main/packages/discord-fake/src/gateway.ts#L393
---

The setting applies to all connections, including those that have not identified. Disabling ACKs does not close sockets or stop heartbeat counting for authenticated sessions.
