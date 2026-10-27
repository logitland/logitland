---
title: Create a message
description: Send a message as a user, or create a post in a forum or media channel.
operation:
  method: POST
  path: /_fake/messages
  server: http://127.0.0.1:8790
  auth: none
  requestBody:
    schema:
      type: object
      required:
        - channel
        - as
        - content
      properties:
        channel:
          type: string
        as:
          type: string
        content:
          type: string
        reply_to:
          type: string
        type:
          type: number
        thread_name:
          type: string
        tags:
          type: array
          items:
            type: string
    example:
      channel: '100000000000000020'
      as: '100000000000000030'
      content: Hello
  responses:
    '200':
      contentType: application/json
      description: The created Message.
    '400':
      description: Invalid input, an unknown user or channel, or a missing forum thread name.
      example:
        error: message
source:
  - label: messages
    href: https://github.com/logitland/logitland/blob/main/packages/discord-fake/src/control.ts#L180
  - label: person message behavior
    href: https://github.com/logitland/logitland/blob/main/packages/discord-fake/src/fake.ts#L342
  - label: world message mutations
    href: https://github.com/logitland/logitland/blob/main/packages/discord-fake/src/world.ts#L477
---

`reply_to` adds a message reference and defaults the message type to `19`. Other numeric `type` values can simulate system messages. Forum posts use `tags` as the applied tag IDs.
