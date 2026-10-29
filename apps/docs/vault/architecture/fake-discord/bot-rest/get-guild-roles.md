---
title: List guild roles
description: List the roles in a guild.
operation:
  method: GET
  path: /api/v10/guilds/{guild}/roles
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
      description: A Role array, including @everyone and the bot role.
    '401':
      description: Missing or wrong bot token (`0`).
    '403':
      description: Another seeded bot's token, or the relay bot is not a member of the guild (`50001`).
    '404':
      description: Unknown guild (`10004`).
source:
  - label: guild.roles
    href: https://github.com/logitland/logitland/blob/main/packages/discord-fake/src/rest.ts#L273
  - label: Role object
    href: https://github.com/logitland/logitland/blob/main/packages/discord-fake/src/model.ts#L84
---

Route name `guild.roles`.
The `/api/v9` and `/api` prefixes also work.
The example guild comes from [`POST /_fake/guilds`](../control-seeding/post-guilds.md) with an explicit ID.
`--seed dev` uses different, fixed IDs.

A Role contains `id`, `name`, `color`, `hoist`, `position`, decimal-string `permissions`, `managed`, `mentionable`, and `flags`.

[Shared REST rules](../index.md#rest-authentication-and-responses) cover rate-limit headers and injected failures.
