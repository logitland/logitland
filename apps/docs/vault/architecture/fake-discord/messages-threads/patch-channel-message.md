---
title: Edit a bot message
description: Change the content or embeds of a message authored by the authenticated fake bot.
operation:
  method: PATCH
  path: /api/v10/channels/{channel}/messages/{message}
  server: http://127.0.0.1:8790
  parameters:
    - name: channel
      in: path
      required: true
      type: string
      description: Guild channel or thread ID; DM channels are not supported.
      example: '100000000000000020'
    - name: message
      in: path
      required: true
      type: string
      description: ID of a message authored by this bot in the channel.
      example: '100000000000000060'
    - name: Authorization
      in: header
      required: true
      type: string
      description: The main fake bot token or a token returned by POST /_fake/bots.
      example: Bot fake-local
  requestBody:
    schema:
      type: object
      properties:
        content:
          type: [string, 'null']
          maxLength: 2000
          description: Omission or null preserves the current content; an empty string requests clearing it.
        embeds:
          type: [array, 'null']
          maxItems: 10
          items: {}
          description: Replacement embeds. Omission or null preserves them; an empty array clears them. Individual entries are not validated.
    example:
      content: Edited by the bot
  responses:
    '200':
      contentType: application/json
      description: The updated stored Message. Sets edited_timestamp and emits MESSAGE_UPDATE on the Gateway.
    '400':
      description: Invalid content or embeds (`50035`); failed empty-message check (`50006`); malformed JSON or a non-object body (`50109`).
    '401':
      description: Missing or unknown bot token (`0`).
    '403':
      description: The message belongs to another author (`50005`), even if the bot has Manage Messages.
    '404':
      description: Unknown or DM channel (`10003`), or unknown message (`10008`).
source:
  - label: channel.message.edit
    href: https://github.com/logitland/logitland/blob/main/packages/discord-fake/src/rest.ts#L556
  - label: Content and embed validation
    href: https://github.com/logitland/logitland/blob/main/packages/discord-fake/src/rest.ts#L63-L75
  - label: Embed array validation
    href: https://github.com/logitland/logitland/blob/main/packages/discord-fake/src/rest.ts#L206-L211
  - label: World.editMessage
    href: https://github.com/logitland/logitland/blob/main/packages/discord-fake/src/world.ts#L526-L542
---

Route name `channel.message.edit`. The `/api/v9` and `/api` prefixes also work.
Use a message ID returned by [message creation](post-channel-messages.md), not the illustrative ID above.
Only guild channels and threads are supported. A DM channel returns `404`, code `10003`, even if the message exists.
The token selects the main fake bot or a bot created with [POST /_fake/bots](../control-seeding/post-bots.md).

Only that bot's own messages can be edited. The fake does not recheck channel permissions or thread archive state for this operation.
It updates only `content` and `embeds`; other fields, including `components`, `poll`, and `allowed_mentions`, are ignored.
Changed content rebuilds mention fields without parsing mentions, so an edit does not ping anyone.

The empty-message check uses the proposed content (or stored content when omitted/null), the stored poll, and the **stored** embeds,
before applying replacement embeds. Components do not count. This fake limitation can reject adding embeds to an otherwise empty
message or allow clearing its last embed; it is not a complete model of Discord's edit validation.

[Shared REST rules](../index.md#rest-authentication-and-responses) cover JSON content types, rate-limit headers, and injected failures.
