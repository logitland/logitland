---
title: List channel messages
description: Return a page of messages newest first, applying the application's Message Content setting.
operation:
  method: GET
  path: /api/v10/channels/{channel}/messages
  server: http://127.0.0.1:8790
  parameters:
    - name: channel
      in: path
      required: true
      type: string
      description: Channel or thread ID.
      example: '100000000000000020'
    - name: Authorization
      in: header
      required: true
      type: string
      description: Relay bot authorization header.
      example: Bot fake-local
    - name: limit
      in: query
      type: integer
      default: 50
      description: Number of messages, from 1 to 100.
      example: 10
    - name: before
      in: query
      type: string
      description: Snowflake cursor; at most one cursor may be provided.
      example: '100000000000000060'
    - name: after
      in: query
      type: string
      description: Snowflake cursor; at most one cursor may be provided.
    - name: around
      in: query
      type: string
      description: Snowflake cursor; at most one cursor may be provided.
  responses:
    '200':
      contentType: application/json
      description: Returns a Message array newest first; without Read Message History, returns an empty array.
    '400':
      description: More than one cursor, a non-snowflake cursor, or an invalid limit.
    '401':
      description: Missing or wrong bot token.
    '403':
      description: The bot lacks View Channel, or the token belongs to another bot (`50001`).
    '404':
      description: Unknown channel.
source:
  - label: channel.messages.list
    href: https://github.com/logitland/logitland/blob/main/packages/discord-fake/src/rest.ts#L370-L389
  - label: pagination
    href: https://github.com/logitland/logitland/blob/main/packages/discord-fake/src/world.ts#L520-L531
  - label: REST content filtering
    href: https://github.com/logitland/logitland/blob/main/packages/discord-fake/src/fake.ts#L297-L302
---

`/api/v9` and `/api` also work. The example channel comes from [`POST /_fake/channels`](../control-seeding/post-channels.md) with an explicit ID. Messages receive generated IDs. Replace the cursor with an ID returned by an earlier request.

## Pagination

- `before` returns messages just older than the cursor.
- `after` selects messages closest to the cursor, then returns that page newest first.
- `around` selects up to half the limit before the cursor, then fills the remaining slots with the cursor (if present) and newer messages. The result is newest first.

Stop paging when the response is empty. Use the oldest returned ID for the next `before` page, or the newest for the next `after` page.

## Message content

Without the application Message Content flag, the fake empties other people's `content`, `embeds`, `attachments`, and `components`, and omits `poll`. The bot's own messages and messages mentioning the bot keep those fields. [`PATCH /_fake/application`](../control-seeding/patch-application.md) sets the flag. [`GET /_fake/messages`](../control-actions/get-messages.md) always returns full content.

[Shared REST rules](../index.md#rest-authentication-and-responses) cover rate-limit headers and injected failures.
