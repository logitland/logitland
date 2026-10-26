---
title: 'GET /api/v10/users/@me'
description: Fake Discord OAuth endpoint that returns the user for a Bearer access token.
---

[Fake Discord](../index.md) / [OAuth](../oauth.md)

Returns the User associated with an OAuth access token.

## Request

- Path: `/api/v10/users/@me`; `/api/v9` or `/api` also work.
- Auth: `Authorization: Bearer <access-token>`.
- Body and query: none.

```sh
curl http://127.0.0.1:8790/api/v10/users/@me \
  -H 'Authorization: Bearer generated-access-token'
```

## Response

Success is `200` with the token's User, including `id`, `username`, `discriminator`, `global_name`, `avatar`, and optional bot/flag fields.

An unknown token, or a token whose user does not exist, returns `401`:

```json
{ "message": "401: Unauthorized", "code": 0 }
```

Without a nonempty Bearer header, this path falls through to the [bot REST handler](../bot-rest/get-users-me.md). There is no fake refresh-token or revocation endpoint.

Source: [user identity](https://github.com/logitland/logitland/blob/main/packages/discord-fake/src/oauth.ts#L83).
