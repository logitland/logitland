---
title: Create a thread
description: Create a standalone thread, or a post with a starter message in a forum or media channel.
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
      description: Relay bot token, or a registered other-bot token for forum/media posts.
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
        type:
          type: integer
          description: For text or announcement parents only; defaults to private thread type 12.
          enum:
            - 10
            - 11
            - 12
        auto_archive_duration:
          type: integer
          description: Minutes for standalone threads; defaults to the parent's value, or 1440. Ignored for forum/media posts.
          enum:
            - 60
            - 1440
            - 4320
            - 10080
        invitable:
          type: boolean
          description: For private threads only; defaults to true. Non-boolean values are ignored.
        applied_tags:
          type: array
          maxItems: 5
          description: Forum/media posts only; IDs must belong to the parent's available_tags.
          items:
            type: string
        message:
          type: object
          description: Required for forum/media posts. Only content and allowed_mentions are stored.
          properties:
            content:
              type: string
              maxLength: 2000
            embeds:
              type: array
              maxItems: 10
            sticker_ids:
              type: array
            allowed_mentions:
              type: object
    example:
      name: Private discussion
      type: 12
      invitable: false
  responses:
    '201':
      contentType: application/json
      description: Returns the thread Channel; forum/media posts also include the starter Message as `message`. The authenticated bot becomes owner and first member; the fake emits `THREAD_CREATE`.
    '400':
      description: Invalid fields, incompatible parent/type, empty forum starter (`50006`), or unknown forum tag (`10087`).
    '401':
      description: Missing or wrong bot token.
    '403':
      description: Missing Create Private/Public Threads, or Send Messages for a forum/media post (`50013`); another bot cannot create standalone threads (`50001`).
    '404':
      description: Unknown channel.
source:
  - label: channel.threads.create
    href: https://github.com/logitland/logitland/blob/main/packages/discord-fake/src/rest.ts#L454-L492
  - label: thread creation
    href: https://github.com/logitland/logitland/blob/main/packages/discord-fake/src/world.ts#L571-L587
  - label: forum and media posts
    href: https://github.com/logitland/logitland/blob/main/packages/discord-fake/src/world.ts#L625-L645
---

`/api/v9` and `/api` also work. The example channel comes from [`POST /_fake/channels`](../control-seeding/post-channels.md) with an explicit ID.

## Standalone threads

Text parents accept public type `11` or private type `12`; announcement parents require type `10`. These threads have a generated ID and no starter message. Only the relay bot can create them.

## Forum and media posts

For a forum or media parent, include a `message` object. Nonempty `message.content`, nonempty `message.embeds`, or any `message.sticker_ids` array satisfies the body check. The fake validates embeds but stores neither embeds nor stickers through this route; it stores only content and parsed mentions.

The post is a public thread whose ID equals its starter message ID. The response includes that message, and `THREAD_CREATE` precedes `MESSAGE_CREATE`. The fake ignores `type`, `auto_archive_duration`, and `invitable` in this branch; the archive duration comes from the parent, or defaults to 1440 minutes.

[Shared REST rules](../index.md#rest-authentication-and-responses) cover JSON bodies, rate-limit headers, and injected failures.
