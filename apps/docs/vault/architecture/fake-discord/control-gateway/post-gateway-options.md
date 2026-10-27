---
title: Configure gateway options
description: Update gateway timing and buffer options.
operation:
  method: POST
  path: /_fake/gateway/options
  server: http://127.0.0.1:8790
  auth: none
  requestBody:
    schema:
      type: object
      properties:
        heartbeatIntervalMs:
          type: number
        resumeWindowMs:
          type: number
        eventLagMs:
          type: number
        bufferLimit:
          type: number
    example:
      eventLagMs: 100
      resumeWindowMs: 1000
  responses:
    '200':
      contentType: application/json
      description: Returns the full options object.
    '400':
      description: Invalid input or world error.
source:
  - label: options
    href: https://github.com/logitland/logitland/blob/main/packages/discord-fake/src/control.ts#L401
---

Omitted fields stay unchanged. Changing the heartbeat interval affects later HELLO frames.
