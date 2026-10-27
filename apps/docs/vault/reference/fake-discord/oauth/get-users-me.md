---
title: Get the OAuth user
description: Return the user associated with an OAuth access token.
operation:
  method: GET
  path: /api/v10/users/@me
  server: http://127.0.0.1:8790
  auth:
    scheme: bearer
    description: An OAuth access token.
  responses:
    '200':
      contentType: application/json
      description: The token's User.
    '401':
      description: Unknown token or token user.
      example:
        message: '401: Unauthorized'
        code: 0
source:
  - label: user identity
    href: https://github.com/logitland/logitland/blob/main/packages/discord-fake/src/oauth.ts#L83
---

Returns the User associated with an OAuth access token.

The `/api/v9` and `/api` prefixes also work. The User includes `id`, `username`, `discriminator`, `global_name`, `avatar`, and optional bot/flag fields.

Without a nonempty Bearer header, this path falls through to the [bot REST handler](../bot-rest/get-users-me.md). There is no fake refresh-token or revocation endpoint.
