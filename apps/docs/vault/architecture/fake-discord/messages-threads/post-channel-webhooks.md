---
title: Create a channel webhook
description: Create a webhook on a channel other than a category or thread.
operation:
  method: POST
  path: /api/v10/channels/{channel}/webhooks
  server: http://127.0.0.1:8790
  parameters:
    - name: channel
      in: path
      required: true
      type: string
      description: Channel ID.
      example: '100000000000000020'
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
          maxLength: 80
    example:
      name: Mirror
  responses:
    '200':
      contentType: application/json
      description: Returns the Webhook, including its token, plus the bot User as `user`.
    '400':
      description: Invalid name, the channel is a category or thread, or the channel already has 15 webhooks.
    '401':
      description: Missing or wrong bot token.
    '403':
      description: The bot lacks Manage Webhooks in the channel (`50013`), or the token belongs to another bot (`50001`).
    '404':
      description: Unknown channel.
source:
  - label: channel.webhooks.create
    href: https://github.com/logitland/logitland/blob/main/packages/discord-fake/src/rest.ts#L477-L488
  - label: Webhook object
    href: https://github.com/logitland/logitland/blob/main/packages/discord-fake/src/model.ts#L161
---

`/api/v9` and `/api` also work. Names containing `clyde` or `discord` in any case are rejected, regardless of the `strictUsernames` execution setting.

The example channel comes from [`POST /_fake/channels`](../control-seeding/post-channels.md) with an explicit ID. Use the returned ID and token with the [webhook routes](../webhooks/index.md).

[Shared REST rules](../index.md#rest-authentication-and-responses) cover JSON bodies, rate-limit headers, and injected failures.
