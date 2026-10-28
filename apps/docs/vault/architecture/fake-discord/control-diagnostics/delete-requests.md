---
title: Clear request records
description: Remove recorded REST requests.
operation:
  method: DELETE
  path: /_fake/requests
  server: http://127.0.0.1:8790
  auth: none
  responses:
    '200':
      description: Request records were cleared.
      example:
        ok: true
    '400':
      description: Invalid input or a world error.
      example:
        error: message
source:
  - label: clear requests
    href: https://github.com/logitland/logitland/blob/main/packages/discord-fake/src/control.ts#L289
---
