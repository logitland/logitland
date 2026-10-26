---
title: GET /users/@me
description: Fake Discord bot REST route that returns the bot user. Bearer tokens reach the OAuth variant instead.
---

[Fake Discord](../index.md) / [Bot REST](../bot-rest.md)

Returns the bot's User. Route name `users.me`.
A request with a nonempty `Authorization: Bearer` header goes to the [OAuth user lookup](../oauth/get-users-me.md) instead.

## Request

- Path: `/api/v10/users/@me`. `/api/v9` and `/api` also work.
- Auth: `Authorization: Bot <bot-token>`, with the fake's bot token (`fake-local` in examples).
- Body and query: none.

```sh
curl http://127.0.0.1:8790/api/v10/users/@me \
  -H 'Authorization: Bot fake-local'
```

Replace `http://127.0.0.1:8790` with the fake's printed `url`.

## Response

`200` with the bot User, plus `verified: true`, `mfa_enabled: false`, and `flags: 0`.
The User contains `id`, `username`, `discriminator`, `global_name`, `avatar`, and `bot`.

## Errors

- `401/0`: missing or wrong bot token.
- [Shared REST rules](../index.md#rest-authentication-and-responses) cover rate-limit headers and injected failures.

Sources: [users.me](https://github.com/logitland/logitland/blob/main/packages/discord-fake/src/rest.ts#L222),
[User object](https://github.com/logitland/logitland/blob/main/packages/discord-fake/src/model.ts#L74).
