---
title: Delete a message
description: Delete a message from a channel.
operation:
  method: DELETE
  path: /_fake/messages/{channel}/{id}
  server: http://127.0.0.1:8790
  auth: none
  parameters:
    - name: channel
      in: path
      type: string
      description: Digit-only channel ID.
      example: '100000000000000020'
    - name: id
      in: path
      type: string
      description: Digit-only message ID.
      example: '100000000000000060'
  responses:
    '200':
      description: The message was deleted.
      example:
        ok: true
    '400':
      description: Invalid input or a missing message.
      example:
        error: Unknown Message
source:
  - label: message delete
    href: https://github.com/logitland/logitland/blob/main/packages/discord-fake/src/control.ts#L205
---
