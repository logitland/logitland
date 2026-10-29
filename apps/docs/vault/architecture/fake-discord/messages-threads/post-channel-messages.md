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
      description: Guild channel, thread, or DM channel ID. DM sends accept only the relay bot token.
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
          description: In legacy guild messages, any array satisfies the body check; stickers are not stored.
        message_reference:
          type: object
        embeds:
          type: array
          maxItems: 10
        components:
          type: array
          description: Legacy messages allow up to five action rows; Components V2 allows up to 40 total components, including nested entries.
          items:
            type: object
        flags:
          type: number
          description: Bit 32768 selects Components V2. Only this bit is stored; other flags are discarded.
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
      description: Returns the stored Message. Guild/thread sends emit MESSAGE_CREATE on the Gateway; DM sends emit no Gateway event.
    '400':
      description: Invalid body, field value, empty message, or unsupported channel type.
    '401':
      description: Missing or wrong bot token.
    '403':
      description: Missing Send Messages or Send Messages in Threads (50013); an additional bot targets a DM (50001); or the DM recipient is in world.closedDms (50007).
    '404':
      description: Unknown channel.
source:
  - label: channel.messages.create
    href: https://github.com/logitland/logitland/blob/main/packages/discord-fake/src/rest.ts#L511-L553
  - label: message validators
    href: https://github.com/logitland/logitland/blob/main/packages/discord-fake/src/rest.ts#L63-L211
  - label: poll validation
    href: https://github.com/logitland/logitland/blob/main/packages/discord-fake/src/rest.ts#L213-L242
  - label: body and reference checks
    href: https://github.com/logitland/logitland/blob/main/packages/discord-fake/src/rest.ts#L241-L258
---

`/api/v9` and `/api` also work. The example channel comes from [`POST /_fake/channels`](../control-seeding/post-channels.md) with an explicit ID.

## Message body

For a legacy guild/thread message, at least one of `content`, `poll`, `embeds`, or `components` must be nonempty. The validator also accepts any `sticker_ids` array, even empty, as a body, but does not store stickers. `tts` is true only for the JSON value `true`.

`message_reference` accepts optional snowflake `message_id`, `channel_id`, and `guild_id` fields. The fake checks their format, not whether the referenced objects exist.

### Embeds and components

`embeds` accepts at most ten entries. The fake does not validate each embed's contents. Without the Components V2 flag, `components` accepts at most five action rows, each with `type: 1` and 1–5 child components. Buttons use styles 1–5 and need a label or emoji. Labels have at most 80 characters. Non-link buttons need a nonempty `custom_id` of at most 100 characters. Style `5` needs `url` and forbids `custom_id`.

With `flags: 32768` (`1 << 15`, Components V2), `components` is a layout with at most 40 components in total, including nested entries:

- Containers (`type: 17`) hold 1–40 children. Optional `accent_color` is null or an integer from 0 to 0xFFFFFF.
- Sections (`9`) hold 1–3 text displays and a button or thumbnail `accessory`.
- Text displays (`10`) need nonempty string `content`; thumbnails (`11`, as section accessories) need string `media.url`.
- Separators (`14`) accept `spacing` 1 or 2. Action rows (`1`) use the button checks above.
- Types `12` and `13` are accepted at the top level or in a container, without further field validation.

Containers cannot be nested. Non-null `content`, `embeds`, `poll`, and `sticker_ids` are refused beside this flag
(`MESSAGE_CANNOT_USE_LEGACY_FIELDS_WITH_COMPONENTS_V2`); omission or null is allowed. Only the Components V2 bit is stored.

### Mentions

`allowed_mentions` accepts string arrays `parse`, `users`, and `roles`, plus boolean `replied_user`. `parse` values must be `users`, `roles`, or `everyone`. Omitting `allowed_mentions` allows normal mention parsing; use `allowed_mentions: { parse: [] }` to suppress it. The fake accepts `replied_user` but does not use it to ping a reply's author.

### Polls

Polls need `question.text` of 1–300 characters and 1–10 answers. Each answer needs `poll_media.text` of 1–55 characters. `duration` is in hours. It defaults to 24 and accepts integers 1–768. `allow_multiselect` defaults to `false`. The fake sets `layout_type: 1` and empty, unfinalized results.

## DM messages

Open a DM with [POST /users/@me/channels](../bot-rest/post-users-me-channels.md), then use its ID here.
Only the relay bot can send; an additional bot gets `403/50001`. A recipient in `world.closedDms` causes `403/50007`.
The DM branch requires nonempty `content` or `components` and supports the same content/component validation, including Components V2.
Without the V2 flag, it ignores `embeds`, `poll`, `sticker_ids`, `allowed_mentions`, `message_reference`, and `tts`.
It stores empty mention fields and emits no Gateway event. DM messages cannot be listed, edited, or deleted through the fake's REST routes.

[`Webhook execution`](../webhooks/post-webhooks-id-token.md#execute-body) shares validation for content, embeds, components, polls, mentions, and `tts`, but does not store `message_reference`. Components are stored only with `with_components=true` on webhook execution.

[Shared REST rules](../index.md#rest-authentication-and-responses) cover JSON bodies, rate-limit headers, and injected failures.
