---
title: Delete a thread
description: Remove a thread and its associated messages and memberships.
operation:
  method: DELETE
  path: /_fake/threads/{id}
  server: http://127.0.0.1:8790
  auth: none
  parameters:
    - name: id
      in: path
      type: string
      description: Digit-only thread ID.
      example: '100000000000000060'
  responses:
    '200':
      description: The thread was deleted.
      example:
        ok: true
    '400':
      description: Invalid input, an unknown channel, or a non-thread channel.
      example:
        error: message
source:
  - label: thread deletion
    href: https://github.com/logitland/logitland/blob/main/packages/discord-fake/src/control.ts#L239
---
