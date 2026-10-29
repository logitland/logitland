---
title: List a bot's guilds
description: Return the fake guilds that contain the authenticated bot as a member.
operation:
  method: GET
  path: /api/v10/users/@me/guilds
  server: http://127.0.0.1:8790
  parameters:
    - name: Authorization
      in: header
      required: true
      type: string
      description: The main fake bot token or a token returned by POST /_fake/bots.
      example: Bot fake-local
  responses:
    '200':
      contentType: application/json
      description: An array of guild summaries; empty when the bot belongs to no guilds.
      example:
        - id: '100000000000000010'
          name: Test server
          icon: null
          owner: false
          permissions: '0'
          features: []
    '401':
      description: Missing or unknown bot token (`0`).
source:
  - label: users.me.guilds
    href: https://github.com/logitland/logitland/blob/main/packages/discord-fake/src/rest.ts#L253
  - label: Bot token lookup
    href: https://github.com/logitland/logitland/blob/main/packages/discord-fake/src/fake.ts#L338
---

Route name `users.me.guilds`. The `/api/v9` and `/api` prefixes also work.
The token selects the main fake bot or a bot created with [POST /_fake/bots](../control-seeding/post-bots.md).

Only guilds whose member list contains that bot are returned. Creating a fake guild adds the main bot automatically;
add another bot with [POST /_fake/members](../control-seeding/post-members.md), using its returned `user_id` as `id`.

Each summary contains `id`, `name`, `icon: null`, `owner`, `permissions: "0"`, and `features: []`.
`owner` compares the guild owner's ID with the bot's ID. `permissions` is a placeholder, not the bot's effective permissions.

The fake returns all matching guilds in one response. It does not implement pagination; `limit`, `before`, and `after` are ignored.
[Shared REST rules](../index.md#rest-authentication-and-responses) cover rate-limit headers and injected failures.
