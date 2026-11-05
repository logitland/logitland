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
          description: Interval advertised in later HELLO frames, in milliseconds; startup default 41250.
        resumeWindowMs:
          type: number
          description: Disconnected session resume window, in milliseconds; startup default 120000.
        eventLagMs:
          type: number
          description: Delay for live world-change dispatches, in milliseconds; startup default 0.
        bufferLimit:
          type: number
          description: Dispatches retained per session for replay; startup default 10000.
    example:
      eventLagMs: 100
      resumeWindowMs: 1000
  responses:
    '200':
      contentType: application/json
      description: Returns the full options object.
    '400':
      description: Invalid JSON, body shape, or nonnumeric option value.
source:
  - label: options
    href: https://github.com/logitland/logitland/blob/main/packages/discord-fake/src/control.ts#L410-L420
  - label: option meanings and defaults
    href: https://github.com/logitland/logitland/blob/main/packages/discord-fake/src/gateway.ts#L66-L77
  - label: dispatch buffering and delay
    href: https://github.com/logitland/logitland/blob/main/packages/discord-fake/src/gateway.ts#L283-L294
---

Omitted or `null` fields stay unchanged. Values are checked for numeric type, not integer or range constraints. Updates apply field by field, so an invalid later field can return `400` after earlier fields have changed.

Changing `heartbeatIntervalMs` does not update existing connections. Changing `bufferLimit` does not immediately trim existing buffers; each new dispatch removes at most one oldest entry when over the limit.
