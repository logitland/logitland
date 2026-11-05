---
title: Get a guild member
description: Return a guild member with its user and roles.
operation:
  method: GET
  path: /api/v10/guilds/{guild}/members/{user}
  server: http://127.0.0.1:8790
  parameters:
    - name: guild
      in: path
      type: string
      description: The guild ID.
      example: '100000000000000010'
    - name: user
      in: path
      type: string
      description: The member's user ID.
      example: '100000000000000030'
    - name: Authorization
      in: header
      required: true
      type: string
      description: The relay bot's token configured on the fake.
      example: Bot fake-local
  responses:
    '200':
      contentType: application/json
      description: The Member object.
    '401':
      description: Missing or wrong bot token (`0`).
    '403':
      description: Another seeded bot's token (`50001`).
    '404':
      description: Unknown guild (`10004`) or member (`10007`).
source:
  - label: guild.member.get
    href: https://github.com/logitland/logitland/blob/main/packages/discord-fake/src/rest.ts#L399
  - label: Member object
    href: https://github.com/logitland/logitland/blob/main/packages/discord-fake/src/model.ts#L100
---

Route name `guild.member.get`.
This route does not check whether the relay bot belongs to the guild.
The `/api/v9` and `/api` prefixes also work.
The example guild and member come from [`POST /_fake/guilds`](../control-seeding/post-guilds.md) and [`POST /_fake/members`](../control-seeding/post-members.md) with explicit IDs.
`--seed dev` uses different, fixed IDs.

[Shared REST rules](../index.md#rest-authentication-and-responses) cover rate-limit headers and injected failures.
