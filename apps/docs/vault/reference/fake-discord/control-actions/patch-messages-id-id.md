---
title: Edit a message
description: Replace the content of a message in a channel.
operation:
  method: PATCH
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
  requestBody:
    schema:
      type: object
      required:
        - content
      properties:
        content:
          type: string
    example:
      content: Edited by Alice
  responses:
    '200':
      contentType: application/json
      description: The edited Message.
    '400':
      description: Invalid input or a missing message.
      example:
        error: Unknown Message
source:
  - label: message edit
    href: https://github.com/logitland/logitland/blob/main/packages/discord-fake/src/control.ts#L203
---
