---
title: Bulk-delete messages
description: Delete selected messages from a channel and emit a bulk-delete event.
operation:
  method: POST
  path: /_fake/messages/bulk-delete
  server: http://127.0.0.1:8790
  auth: none
  requestBody:
    schema:
      type: object
      required:
        - channel
        - ids
      properties:
        channel:
          type: string
        ids:
          type: array
          items:
            type: string
    example:
      channel: '100000000000000020'
      ids:
        - '100000000000000060'
        - '100000000000000061'
  responses:
    '200':
      description: The messages were deleted and MESSAGE_DELETE_BULK was emitted.
      example:
        ok: true
    '400':
      description: Invalid input or a world error.
      example:
        error: message
source:
  - label: bulk delete
    href: https://github.com/logitland/logitland/blob/main/packages/discord-fake/src/control.ts#L194
---
