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
      description: Relay bot authorization header.
      example: Bot fake-local
  requestBody:
    schema:
      type: object
      properties:
        name:
          type: string
          minLength: 1
          maxLength: 100
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
      description: The bot lacks Manage Threads (`50013`), or the token belongs to another bot (`50001`).
    '404':
      description: Unknown channel.
source:
  - label: channel.modify
    href: https://github.com/logitland/logitland/blob/main/packages/discord-fake/src/rest.ts#L508-L521
  - label: thread modification
    href: https://github.com/logitland/logitland/blob/main/packages/discord-fake/src/world.ts#L647-L660
---

`/api/v9` and `/api` also work. Omitted fields stay unchanged.

## Permission rules

The relay bot can archive or unarchive a thread it owns without Manage Threads. A non-null `name` or a `locked` field requires Manage Threads, even for the owner. Updating someone else's thread always requires that permission.

Omitted fields and `name: null` leave values unchanged. When supplied, `archived` and `locked` must be booleans; `null` is invalid. An empty body object is allowed, subject to the same owner/permission check.

[Shared REST rules](../index.md#rest-authentication-and-responses) cover JSON bodies, rate-limit headers, and injected failures.
