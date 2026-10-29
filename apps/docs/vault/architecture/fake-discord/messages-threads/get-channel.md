---
title: Get a channel
description: Return a channel or thread by ID.
operation:
  method: GET
  path: /api/v10/channels/{channel}
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
  responses:
    '200':
      contentType: application/json
      description: Returns the Channel, including IDs, type, name, parent, position, overwrites, and optional thread metadata or forum tags.
    '401':
      description: Missing or wrong bot token.
    '403':
      description: The token belongs to another bot (`50001`).
    '404':
      description: Unknown channel.
source:
  - label: channel.get
    href: https://github.com/logitland/logitland/blob/main/packages/discord-fake/src/rest.ts#L475
  - label: Channel object
    href: https://github.com/logitland/logitland/blob/main/packages/discord-fake/src/model.ts#L138
---

`/api/v9` and `/api` also work. The example channel comes from [`POST /_fake/channels`](../control-seeding/post-channels.md) with an explicit ID. `--seed dev` uses different, fixed IDs.

This route does not check the bot's channel permissions. [Shared REST rules](../index.md#rest-authentication-and-responses) cover rate-limit headers and injected failures.
