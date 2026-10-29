---
title: Create a channel message
description: Post a bot message with content, embeds, components, polls, and mention validation.
operation:
  method: POST
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
      description: Relay bot or registered other-bot authorization header.
      example: Bot fake-local
  requestBody:
    schema:
      type: object
      properties:
        content:
          type: string
          maxLength: 2000
        tts:
          type: boolean
          default: false
        sticker_ids:
          type: array
          description: Any array satisfies the body check; stickers are not stored.
        message_reference:
          type: object
        embeds:
          type: array
          maxItems: 10
        components:
          type: array
          maxItems: 5
          items:
            type: object
        allowed_mentions:
          type: object
        poll:
          type: object
    example:
      content: Hello from the bot
      allowed_mentions:
        parse: []
      poll:
        question:
          text: Which channel?
        answers:
          - poll_media:
              text: General
        duration: 24
        allow_multiselect: false
  responses:
    '200':
      contentType: application/json
      description: Returns the stored Message and emits `MESSAGE_CREATE` on the Gateway.
    '400':
      description: Invalid body, field value, empty message, or unsupported channel type.
    '401':
      description: Missing or wrong bot token.
    '403':
      description: The bot lacks Send Messages or Send Messages in Threads.
    '404':
      description: Unknown channel.
source:
  - label: channel.messages.create
    href: https://github.com/logitland/logitland/blob/main/packages/discord-fake/src/rest.ts#L391-L414
  - label: message validators
    href: https://github.com/logitland/logitland/blob/main/packages/discord-fake/src/rest.ts#L62-L131
  - label: poll validation
    href: https://github.com/logitland/logitland/blob/main/packages/discord-fake/src/rest.ts#L133-L162
  - label: body and reference checks
    href: https://github.com/logitland/logitland/blob/main/packages/discord-fake/src/rest.ts#L161-L178
---

`/api/v9` and `/api` also work. The example channel comes from [`POST /_fake/channels`](../control-seeding/post-channels.md) with an explicit ID.

## Message body

At least one of `content`, `poll`, `embeds`, or `components` must be nonempty. The validator also accepts any `sticker_ids` array, even empty, as a body, but does not store stickers. `tts` is true only for the JSON value `true`.

`message_reference` accepts optional snowflake `message_id`, `channel_id`, and `guild_id` fields. The fake checks their format, not whether the referenced objects exist.

### Embeds and components

`embeds` accepts at most ten entries. The fake does not validate each embed's contents. `components` accepts at most five action rows, each with `type: 1` and 1–5 child components. Buttons use styles 1–5 and need a label or emoji. Labels have at most 80 characters. Non-link buttons need a nonempty `custom_id` of at most 100 characters. Style `5` needs `url` and forbids `custom_id`.

### Mentions

`allowed_mentions` accepts string arrays `parse`, `users`, and `roles`, plus boolean `replied_user`. `parse` values must be `users`, `roles`, or `everyone`. Omitting `allowed_mentions` allows normal mention parsing; use `allowed_mentions: { parse: [] }` to suppress it. The fake accepts `replied_user` but does not use it to ping a reply's author.

### Polls

Polls need `question.text` of 1–300 characters and 1–10 answers. Each answer needs `poll_media.text` of 1–55 characters. `duration` is in hours. It defaults to 24 and accepts integers 1–768. `allow_multiselect` defaults to `false`. The fake sets `layout_type: 1` and empty, unfinalized results.

[`Webhook execution`](../webhooks/post-webhooks-id-token.md#execute-body) shares validation for content, embeds, components, polls, mentions, and `tts`, but does not store `message_reference`. Components are stored only with `with_components=true` on webhook execution.

[Shared REST rules](../index.md#rest-authentication-and-responses) cover JSON bodies, rate-limit headers, and injected failures.
