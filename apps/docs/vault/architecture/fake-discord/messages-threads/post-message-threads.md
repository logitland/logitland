---
title: Start a thread from a message
description: Start a thread from a message in a text or announcement channel.
operation:
  method: POST
  path: /api/v10/channels/{channel}/messages/{message}/threads
  server: http://127.0.0.1:8790
  parameters:
    - name: channel
      in: path
      required: true
      type: string
      description: Parent channel ID.
      example: '100000000000000020'
    - name: message
      in: path
      required: true
      type: string
      description: Starter message ID.
      example: '100000000000000060'
    - name: Authorization
      in: header
      required: true
      type: string
      description: Relay bot authorization header.
      example: Bot fake-local
  requestBody:
    schema:
      type: object
      required:
        - name
      properties:
        name:
          type: string
          minLength: 1
          maxLength: 100
        auto_archive_duration:
          type: integer
          description: Minutes; defaults to the parent's value, or 1440.
          enum:
            - 60
            - 1440
            - 4320
            - 10080
    example:
      name: Discussion
  responses:
    '201':
      contentType: application/json
      description: Returns a thread Channel whose ID equals the starter message ID. The bot becomes owner and first member; the fake emits `THREAD_CREATE` and then `MESSAGE_UPDATE` for the starter.
    '400':
      description: Invalid parent type, name, archive duration, or message already has a thread.
    '401':
      description: Missing or wrong bot token.
    '403':
      description: The bot lacks Create Public Threads (`50013`), or the token belongs to another bot (`50001`).
    '404':
      description: Unknown channel or message.
source:
  - label: channel.messages.thread
    href: https://github.com/logitland/logitland/blob/main/packages/discord-fake/src/rest.ts#L436-L452
  - label: message threads
    href: https://github.com/logitland/logitland/blob/main/packages/discord-fake/src/world.ts#L603-L619
---

`/api/v9` and `/api` also work. The example channel comes from [`POST /_fake/channels`](../control-seeding/post-channels.md) with an explicit ID. Messages receive generated IDs. Replace the message ID with one returned by an earlier request.

A text parent creates a public thread, type `11`; an announcement parent creates type `10`.

[Shared REST rules](../index.md#rest-authentication-and-responses) cover JSON bodies, rate-limit headers, and injected failures.
