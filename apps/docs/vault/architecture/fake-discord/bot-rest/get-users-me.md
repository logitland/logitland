---
title: Get the bot user
description: Return the user profile associated with a fake bot token.
operation:
  method: GET
  path: /api/v10/users/@me
  server: http://127.0.0.1:8790
  parameters:
    - name: Authorization
      in: header
      required: true
      type: string
      description: The relay bot's token or another bot token seeded in the fake.
      example: Bot fake-local
  responses:
    '200':
      contentType: application/json
      description: 'The bot User with `verified: true`, `mfa_enabled: false`, and `flags: 0`.'
    '401':
      description: Missing or wrong bot token (`0`).
source:
  - label: users.me
    href: https://github.com/logitland/logitland/blob/main/packages/discord-fake/src/rest.ts#L239
  - label: User object
    href: https://github.com/logitland/logitland/blob/main/packages/discord-fake/src/model.ts#L74
---

Route name `users.me`.
The `/api/v9` and `/api` prefixes also work. A token seeded with `DiscordFake.addBot` returns that bot's profile, not the relay bot's.
A request with `Authorization: Bearer <access-token>` goes to the [OAuth user lookup](../oauth/get-users-me.md) instead.

The User contains `id`, `username`, `discriminator`, `global_name`, `avatar`, and `bot`.

[Shared REST rules](../index.md#rest-authentication-and-responses) cover rate-limit headers and injected failures.
