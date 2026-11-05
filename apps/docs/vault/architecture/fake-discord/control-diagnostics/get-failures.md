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
      description: An object with a failures array containing each rule's id, match, behaviour, times, and hits.
    '400':
      description: Invalid input or a world error.
      example:
        error: message
source:
  - label: list rules
    href: https://github.com/logitland/logitland/blob/main/packages/discord-fake/src/control.ts#L309
  - label: rule snapshot
    href: https://github.com/logitland/logitland/blob/main/packages/discord-fake/src/control.ts#L88
---

`times` is the configured total hit limit, not the number of hits remaining. Infinite `times` appears as `"forever"`.
Exhausted rules remain in the list until removed.
