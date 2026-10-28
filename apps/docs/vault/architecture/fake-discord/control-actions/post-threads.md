---
title: Create a thread
description: Start a thread from a message in a channel.
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
        message:
          type: string
        name:
          type: string
        as:
          type: string
    example:
      channel: '100000000000000020'
      message: '100000000000000060'
      name: Discussion
      as: '100000000000000030'
  responses:
    '200':
      contentType: application/json
      description: A Thread Channel is created.
    '400':
      description: Invalid input, a wrong parent type, a missing starter, or an existing thread.
      example:
        error: message
source:
  - label: thread creation
    href: https://github.com/logitland/logitland/blob/main/packages/discord-fake/src/control.ts#L225
---

The optional `as` field selects an existing user ID; by default the bot creates the thread.
