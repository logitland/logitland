---
title: Update a thread
description: Change a thread's name, archived state, or locked state.
operation:
  method: PATCH
  path: /api/v10/channels/{channel}
  server: http://127.0.0.1:8790
  parameters:
    - name: channel
      in: path
      required: true
      type: string
      description: Thread ID.
      example: '100000000000000060'
    - name: Authorization
      in: header
      required: true
      type: string
      description: Discord bot authorization header.
      example: Bot fake-local
  requestBody:
    schema:
      type: object
      properties:
        name:
          type: string
        archived:
          type: boolean
        locked:
          type: boolean
    example:
      archived: true
  responses:
    '200':
      contentType: application/json
      description: Returns the updated Channel and emits `THREAD_UPDATE`.
    '400':
      description: The channel is not a thread or an input is invalid.
    '401':
      description: Missing or wrong bot token.
    '403':
      description: The bot lacks Manage Threads.
    '404':
      description: Unknown channel.
source:
  - label: channel.modify
    href: https://github.com/logitland/logitland/blob/main/packages/discord-fake/src/rest.ts#L431
  - label: thread modification
    href: https://github.com/logitland/logitland/blob/main/packages/discord-fake/src/world.ts#L644
---

`/api/v9` and `/api` also work. Omitted fields stay unchanged.

## Permission rules

The bot needs Manage Threads unless the thread creator changes only `archived`. [Shared REST rules](../index.md#rest-authentication-and-responses) cover JSON bodies, rate-limit headers, and injected failures.
