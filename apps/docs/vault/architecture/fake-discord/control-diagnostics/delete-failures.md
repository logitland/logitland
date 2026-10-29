---
title: Clear failure rules
description: Remove all configured failure rules.
operation:
  method: DELETE
  path: /_fake/failures
  server: http://127.0.0.1:8790
  auth: none
  responses:
    '200':
      description: All failure rules were cleared.
      example:
        ok: true
    '400':
      description: Invalid input or a world error.
      example:
        error: message
source:
  - label: clear rules
    href: https://github.com/logitland/logitland/blob/main/packages/discord-fake/src/control.ts#L324-L332
---
