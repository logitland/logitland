---
title: Get the bot user
description: Return the fake bot's user profile.
operation:
  method: GET
  path: /api/v10/users/@me
  server: http://127.0.0.1:8790
  parameters:
    - name: Authorization
      in: header
      required: true
      type: string
      description: The fake bot token.
      example: Bot fake-local
  responses:
    '200':
      contentType: application/json
      description: 'The bot User with `verified: true`, `mfa_enabled: false`, and `flags: 0`.'
    '401':
      description: Missing or wrong bot token (`0`).
source:
  - label: users.me
    href: https://github.com/logitland/logitland/blob/main/packages/discord-fake/src/rest.ts#L222
  - label: User object
    href: https://github.com/logitland/logitland/blob/main/packages/discord-fake/src/model.ts#L74
---

Route name `users.me`.
A request with a nonempty `Authorization: Bearer` header goes to the [OAuth user lookup](../oauth/get-users-me.md) instead.

The User contains `id`, `username`, `discriminator`, `global_name`, `avatar`, and `bot`.

- [Shared REST rules](../index.md#rest-authentication-and-responses) cover rate-limit headers and injected failures.
