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
      description: Invalid input, an unknown channel, or a missing message.
      example:
        error: Unknown Message
source:
  - label: bulk delete
    href: https://github.com/logitland/logitland/blob/main/packages/discord-fake/src/control.ts#L203-L210
  - label: World.deleteMessages
    href: https://github.com/logitland/logitland/blob/main/packages/discord-fake/src/world.ts#L553-L564
---

Every distinct ID must exist in the channel; if any is missing, no messages are deleted.
Duplicate IDs are deleted once. This control action accepts an empty list and imposes no message-count or age limit.
