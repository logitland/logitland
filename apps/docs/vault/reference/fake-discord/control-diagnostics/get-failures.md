---
title: List failure rules
description: List configured failure rules and their current hit counts.
operation:
  method: GET
  path: /_fake/failures
  server: http://127.0.0.1:8790
  auth: none
  responses:
    '200':
      contentType: application/json
      description: Failure rules with their match, behavior, remaining configuration, and hits.
    '400':
      description: Invalid input or a world error.
      example:
        error: message
source:
  - label: list rules
    href: https://github.com/logitland/logitland/blob/main/packages/discord-fake/src/control.ts#L300
---

Infinite `times` appears as `"forever"`.
