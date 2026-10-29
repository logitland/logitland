---
title: Set next resume result
description: Override the next well-formed RESUME with a recognized bot token on an unauthenticated connection.
operation:
  method: POST
  path: /_fake/gateway/next-resume
  server: http://127.0.0.1:8790
  auth: none
  requestBody:
    schema:
      type: object
      required:
        - mode
      properties:
        mode:
          type: string
          enum:
            - ok
            - invalid
            - invalid-resumable
    example:
      mode: invalid-resumable
  responses:
    '200':
      description: Returns the configured mode.
      example:
        mode: invalid-resumable
    '400':
      description: Invalid JSON, missing or non-string mode, or mode outside the allowed values.
source:
  - label: next resume
    href: https://github.com/logitland/logitland/blob/main/packages/discord-fake/src/control.ts#L384-L393
  - label: RESUME validation and override order
    href: https://github.com/logitland/logitland/blob/main/packages/discord-fake/src/gateway.ts#L498-L518
---

The setting is consumed once, after RESUME shape and bot-token validation, even if the requested session is unknown, belongs to another bot, or has expired. It resets to `ok` immediately. Rejected tokens and RESUME on an already authenticated connection do not consume it.

| Mode                | Result                                                                                                 |
| ------------------- | ------------------------------------------------------------------------------------------------------ |
| `ok`                | Apply normal session, sequence, and replay checks; success is not guaranteed.                          |
| `invalid`           | Send opcode `9`, `d: false`; expire the matching session if it belongs to the token's bot.             |
| `invalid-resumable` | Send opcode `9`, `d: true` before session or sequence checks, without attaching or expiring a session. |
