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
      description: Discord bot authorization header.
      example: Bot fake-local
  requestBody:
    schema:
      type: object
      properties:
        content:
          type: string
        tts:
          type: boolean
        sticker_ids:
          type: array
          items:
            type: string
        message_reference:
          type: object
        embeds:
          type: array
          items:
            type: object
        components:
          type: array
          items:
            type: object
        allowed_mentions:
          type: object
        poll:
          type: object
    example:
      content: Hello from the bot
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
    href: https://github.com/logitland/logitland/blob/main/packages/discord-fake/src/rest.ts#L511
  - label: message validators
    href: https://github.com/logitland/logitland/blob/main/packages/discord-fake/src/rest.ts#L62
  - label: poll validation
    href: https://github.com/logitland/logitland/blob/main/packages/discord-fake/src/rest.ts#L127
  - label: body and reference checks
    href: https://github.com/logitland/logitland/blob/main/packages/discord-fake/src/rest.ts#L161
---

`/api/v9` and `/api` also work. The example channel comes from [`POST /_fake/channels`](../control-seeding/post-channels.md) with an explicit ID.

## Message body

`content` is optional, with at most 2,000 characters. A nonempty `content`, poll, embeds array, or components array makes a nonempty message. The validator also accepts a `sticker_ids` array as a body, but does not store stickers. `tts` defaults to `false`. `message_reference` accepts optional snowflake `message_id`, `channel_id`, and `guild_id` fields.

`embeds` accepts at most ten entries. The fake does not validate each embed's contents. `components` accepts at most five action rows, each with `type: 1` and 1–5 child components. Buttons use styles 1–5 and need a label or emoji. Labels have at most 80 characters. Non-link buttons need a nonempty `custom_id` of at most 100 characters. Style `5` needs `url` and forbids `custom_id`.

With `flags: 32768` (`1 << 15`, Components V2), `components` is a layout instead: containers (17, `accent_color` 0–0xFFFFFF), sections (9, one to three text displays and a button or thumbnail `accessory`), text displays (10, nonempty `content`), thumbnails (11, `media.url`), separators (14, `spacing` 1 or 2) and action rows, at most 40 components in all. `content`, `embeds`, `poll` and `sticker_ids` are then refused (`MESSAGE_CANNOT_USE_LEGACY_FIELDS_WITH_COMPONENTS_V2`), and the message keeps the flag.

In a DM channel from [`POST /users/@me/channels`](../bot-rest/post-users-me-channels.md), only the relay's bot may post, with `content` or components; someone in `world.closedDms` answers `403` with code `50007`. DM messages emit no Gateway event.

`allowed_mentions` accepts string arrays `parse`, `users`, and `roles`, plus boolean `replied_user`. `parse` values must be `users`, `roles`, or `everyone`.

Polls need `question.text` of 1–300 characters and 1–10 answers. Each answer needs `poll_media.text` of 1–55 characters. `duration` is in hours. It defaults to 24 and accepts integers 1–768. `allow_multiselect` defaults to `false`. The fake sets `layout_type: 1` and empty, unfinalized results.

[`POST /webhooks/:id/:token`](../webhooks/post-webhooks-id-token.md) uses the same rules for these fields. [Shared REST rules](../index.md#rest-authentication-and-responses) cover JSON bodies, rate-limit headers, and injected failures.

Another request body, poll:

```json
{
  "poll": {
    "question": {
      "text": "Which channel?"
    },
    "answers": [
      {
        "poll_media": {
          "text": "General"
        }
      }
    ],
    "duration": 24,
    "allow_multiselect": false
  }
}
```
