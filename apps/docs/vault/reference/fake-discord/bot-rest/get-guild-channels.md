---
title: List guild channels
description: List a guild's non-thread channels in position order.
operation:
  method: GET
  path: /api/v10/guilds/{guild}/channels
  server: http://127.0.0.1:8790
  parameters:
    - name: guild
      in: path
      type: string
      description: The guild ID.
      example: '100000000000000010'
    - name: Authorization
      in: header
      required: true
      type: string
      description: The fake bot token.
      example: Bot fake-local
  responses:
    '200':
      contentType: application/json
      description: A Channel array.
    '401':
      description: Missing or wrong bot token (`0`).
    '403':
      description: The bot is not a member of the guild (`50001`).
    '404':
      description: Unknown guild (`10004`).
source:
  - label: guild.channels
    href: https://github.com/logitland/logitland/blob/main/packages/discord-fake/src/rest.ts#L228
  - label: Channel object
    href: https://github.com/logitland/logitland/blob/main/packages/discord-fake/src/model.ts#L124
---

Route name `guild.channels`. The route excludes threads and sorts channels by `position`.
A Channel contains IDs, type, name, parent, position, overwrites, and optional forum tags.
The `/api/v9` and `/api` prefixes also work.
The example guild comes from [`POST /_fake/guilds`](../control-seeding/post-guilds.md) with an explicit ID.
`--seed dev` generates different IDs.

- [Shared REST rules](../index.md#rest-authentication-and-responses) cover rate-limit headers and injected failures.
