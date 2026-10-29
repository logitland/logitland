---
title: Create a thread
description: Start a thread from a message in a text or announcement channel.
operation:
  method: POST
  path: /_fake/threads
  server: http://127.0.0.1:8790
  auth: none
  requestBody:
    schema:
      type: object
      required:
        - channel
        - message
        - name
      properties:
        channel:
          type: string
          description: Existing text or announcement channel ID.
        message:
          type: string
          description: Existing message ID in the parent channel; also becomes the thread ID.
        name:
          type: string
        as:
          type: string
          description: Existing fake user ID for the thread owner; defaults to the fake's bot user.
    example:
      channel: '100000000000000020'
      message: '100000000000000060'
      name: Discussion
      as: '100000000000000030'
  responses:
    '200':
      contentType: application/json
      description: The created Thread Channel; THREAD_CREATE and a starter MESSAGE_UPDATE were emitted.
    '400':
      description: Invalid input, an unknown channel or user, a wrong parent type, a missing starter, or an existing thread.
      example:
        error: message
source:
  - label: thread creation
    href: https://github.com/logitland/logitland/blob/main/packages/discord-fake/src/control.ts#L234
  - label: DiscordFake.startThread
    href: https://github.com/logitland/logitland/blob/main/packages/discord-fake/src/fake.ts#L403-L405
  - label: World.createThreadFromMessage
    href: https://github.com/logitland/logitland/blob/main/packages/discord-fake/src/world.ts#L603-L619
---

Text channels produce public threads (`type: 11`); announcement channels produce announcement threads (`type: 10`).
The auto-archive duration comes from the parent channel, or defaults to `1440` minutes.
