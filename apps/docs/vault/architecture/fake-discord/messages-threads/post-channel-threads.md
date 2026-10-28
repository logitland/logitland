---
title: Create a thread
description: Create a thread without a starter message, private by default.
operation:
  method: POST
  path: /api/v10/channels/{channel}/threads
  server: http://127.0.0.1:8790
  parameters:
    - name: channel
      in: path
      required: true
      type: string
      description: Parent channel ID.
      example: '100000000000000020'
    - name: Authorization
      in: header
      required: true
      type: string
      description: Discord bot authorization header.
      example: Bot fake-local
  requestBody:
    schema:
      type: object
      required:
        - name
      properties:
        name:
          type: string
        type:
          type: integer
          enum:
            - 10
            - 11
            - 12
        auto_archive_duration:
          type: integer
          enum:
            - 60
            - 1440
            - 4320
            - 10080
        invitable:
          type: boolean
    example:
      name: Private discussion
      type: 12
      invitable: false
  responses:
    '201':
      contentType: application/json
      description: Returns the thread Channel with a generated ID and no starter message. The bot becomes its owner and first member; the fake emits `THREAD_CREATE`.
    '400':
      description: Invalid type, name, auto archive duration, or parent channel type.
    '401':
      description: Missing or wrong bot token.
    '403':
      description: The bot lacks Create Private Threads or Create Public Threads.
    '404':
      description: Unknown channel.
source:
  - label: channel.threads.create
    href: https://github.com/logitland/logitland/blob/main/packages/discord-fake/src/rest.ts#L395
  - label: thread creation
    href: https://github.com/logitland/logitland/blob/main/packages/discord-fake/src/world.ts#L568
---

`/api/v9` and `/api` also work. The example channel comes from [`POST /_fake/channels`](../control-seeding/post-channels.md) with an explicit ID.

`name` is required and 1–100 characters. `type` defaults to private thread `12`. Types `11` and `12` fit text parents; type `10` fits announcement parents. `auto_archive_duration` defaults to the parent's value, or `1440`. `invitable` defaults to `true` for private threads. [Shared REST rules](../index.md#rest-authentication-and-responses) cover JSON bodies, rate-limit headers, and injected failures.
