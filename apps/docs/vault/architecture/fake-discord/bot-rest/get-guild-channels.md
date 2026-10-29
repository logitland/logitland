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
      description: The relay bot's token configured on the fake.
      example: Bot fake-local
  responses:
    '200':
      contentType: application/json
      description: A Channel array.
    '401':
      description: Missing or wrong bot token (`0`).
    '403':
      description: Another seeded bot's token, or the relay bot is not a member of the guild (`50001`).
    '404':
      description: Unknown guild (`10004`).
source:
  - label: guild.channels
    href: https://github.com/logitland/logitland/blob/main/packages/discord-fake/src/rest.ts#L387
  - label: Channel object
    href: https://github.com/logitland/logitland/blob/main/packages/discord-fake/src/model.ts#L138
---

Route name `guild.channels`. The route excludes threads and sorts channels by `position`.
It requires the relay bot to belong to the guild but does not filter channels by channel permissions.
A Channel contains IDs, type, name, parent, position, overwrites, and optional forum tags.
The `/api/v9` and `/api` prefixes also work.
The example guild comes from [`POST /_fake/guilds`](../control-seeding/post-guilds.md) with an explicit ID.
`--seed dev` uses different, fixed IDs.

[Shared REST rules](../index.md#rest-authentication-and-responses) cover rate-limit headers and injected failures.
