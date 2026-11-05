---
title: Remove a failure rule
description: Remove a configured failure rule by its numeric ID.
operation:
  method: DELETE
  path: /_fake/failures/{id}
  server: http://127.0.0.1:8790
  auth: none
  parameters:
    - name: id
      in: path
      type: string
      description: Digit-only failure rule ID.
      example: '1'
  responses:
    '200':
      description: The rule was removed if it existed.
      example:
        ok: true
    '400':
      description: Invalid input or a world error.
      example:
        error: message
    '404':
      description: The ID contains characters other than digits, so no control route matches.
source:
  - label: remove rule
    href: https://github.com/logitland/logitland/blob/main/packages/discord-fake/src/control.ts#L324-L332
---

An unknown ID also succeeds.
