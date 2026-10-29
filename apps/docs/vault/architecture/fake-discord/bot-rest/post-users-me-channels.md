---
title: Open a DM
description: Open the relay bot's DM channel with a user.
operation:
  method: POST
  path: /api/v10/users/@me/channels
  server: http://127.0.0.1:8790
  parameters:
    - name: Authorization
      in: header
      required: true
      type: string
      description: The fake bot token.
      example: Bot fake-local
  requestBody:
    schema:
      type: object
      required: [recipient_id]
      properties:
        recipient_id:
          type: string
    example:
      recipient_id: '100000000000000030'
  responses:
    '200':
      contentType: application/json
      description: 'The DM channel: `id`, `type: 1`, `last_message_id` and `recipients`. The same channel every time for one user.'
    '400':
      description: '`recipient_id` is not a snowflake (`50035`), or the fake knows no such user (`50033`).'
    '401':
      description: Missing or wrong bot token (`0`).
source:
  - label: users.me.channels
    href: https://github.com/logitland/logitland/blob/main/packages/discord-fake/src/rest.ts#L346
  - label: DM channels
    href: https://github.com/logitland/logitland/blob/main/packages/discord-fake/src/world.ts
---

Route name `users.me.channels`. Open DMs are in `world.dms`; post in one with
[`POST /channels/:channel/messages`](../messages-threads/post-channel-messages.md). Add a user ID to `world.closedDms`
to have Discord refuse messages to them with `50007`, as it does for someone who doesn't take DMs from server members.

## Errors

- [Shared REST rules](../index.md#rest-authentication-and-responses) cover rate-limit headers and injected failures.
