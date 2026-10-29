---
title: Delete a channel message
description: Delete a fake bot's own message, or another author's message with Manage Messages.
operation:
  method: DELETE
  path: /api/v10/channels/{channel}/messages/{message}
  server: http://127.0.0.1:8790
  parameters:
    - name: channel
      in: path
      required: true
      type: string
      description: Channel or thread ID.
      example: '100000000000000020'
    - name: message
      in: path
      required: true
      type: string
      description: ID of a message in the channel.
      example: '100000000000000060'
    - name: Authorization
      in: header
      required: true
      type: string
      description: The main fake bot token or a token returned by POST /_fake/bots.
      example: Bot fake-local
  responses:
    '204':
      description: Message deleted, with no response body. Emits MESSAGE_DELETE on the Gateway.
      empty: true
    '401':
      description: Missing or unknown bot token (`0`).
    '403':
      description: Deleting another author's message requires Manage Messages in the channel (`50013`).
    '404':
      description: Unknown channel (`10003`) or message (`10008`).
source:
  - label: channel.message.delete
    href: https://github.com/logitland/logitland/blob/main/packages/discord-fake/src/rest.ts#L428
  - label: Channel permission check
    href: https://github.com/logitland/logitland/blob/main/packages/discord-fake/src/rest.ts#L183-L185
  - label: World.deleteMessage
    href: https://github.com/logitland/logitland/blob/main/packages/discord-fake/src/world.ts#L497-L504
---

Route name `channel.message.delete`. The `/api/v9` and `/api` prefixes also work.
Use a message ID returned by [message creation](post-channel-messages.md), not the illustrative ID above.
The token selects the main fake bot or a bot created with [POST /_fake/bots](../control-seeding/post-bots.md).

Deleting that bot's own message does not recheck channel permissions. Deleting anyone else's message requires Manage Messages,
using the fake's channel-permission rules; private-thread access also applies to that permission check.
The handler does not check thread archive state.

Deletion removes the stored message. Repeating the request returns `404`, code `10008`; it does not return another `204`.
The Gateway event contains `id`, `channel_id`, and `guild_id`.
[Shared REST rules](../index.md#rest-authentication-and-responses) cover rate-limit headers, ignored DELETE body errors, and injected failures.
