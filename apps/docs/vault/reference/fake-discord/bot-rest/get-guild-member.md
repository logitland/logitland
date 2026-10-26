---
title: 'GET /guilds/:guild/members/:user'
description: Fake Discord bot REST route that returns one guild member with user and roles.
---

[Fake Discord](../index.md) / [Bot REST](../bot-rest.md)

Returns one guild member. Route name `guild.member.get`.

## Request

- Path: `/api/v10/guilds/:guild/members/:user`. `/api/v9` and `/api` also work.
- Auth: `Authorization: Bot <bot-token>`, with the fake's bot token (`fake-local` in examples).
- Path parameters: required guild ID `:guild` and user ID `:user`.
- Body and query: none.

```sh
curl http://127.0.0.1:8790/api/v10/guilds/100000000000000010/members/100000000000000030 \
  -H 'Authorization: Bot fake-local'
```

Replace `http://127.0.0.1:8790` with the fake's printed `url`.
The example guild and member come from [`POST /_fake/guilds`](../control-seeding/post-guilds.md) and [`POST /_fake/members`](../control-seeding/post-members.md) with explicit IDs.
`--seed dev` generates different IDs.

## Response

`200` with the Member: `user`, `nick`, `avatar`, `roles`, `joined_at`, and the remaining Discord member fields.

## Errors

- `401/0`: missing or wrong bot token.
- `404/10004`: unknown guild.
- `404/10007`: unknown member.
- [Shared REST rules](../index.md#rest-authentication-and-responses) cover rate-limit headers and injected failures.

This route does not check whether the bot belongs to the guild.

Sources: [guild.member.get](https://github.com/logitland/logitland/blob/main/packages/discord-fake/src/rest.ts#L240),
[Member object](https://github.com/logitland/logitland/blob/main/packages/discord-fake/src/model.ts#L100).
