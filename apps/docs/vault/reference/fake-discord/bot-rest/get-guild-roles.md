---
title: 'GET /guilds/:guild/roles'
description: Fake Discord bot REST route that lists a guild's roles.
---

[Fake Discord](../index.md) / [Bot REST](../bot-rest.md)

Lists a guild's roles. Route name `guild.roles`.

## Request

- Path: `/api/v10/guilds/:guild/roles`. `/api/v9` and `/api` also work.
- Auth: `Authorization: Bot <bot-token>`, with the fake's bot token (`fake-local` in examples).
- Path parameter: required guild ID `:guild`.
- Body and query: none.

```sh
curl http://127.0.0.1:8790/api/v10/guilds/100000000000000010/roles \
  -H 'Authorization: Bot fake-local'
```

Replace `http://127.0.0.1:8790` with the fake's printed `url`.
The example guild comes from [`POST /_fake/guilds`](../control-seeding/post-guilds.md) with an explicit ID.
`--seed dev` generates different IDs.

## Response

`200` with a Role array, including @everyone and the bot role.
A Role contains `id`, `name`, `color`, `hoist`, `position`, decimal-string `permissions`, `managed`, `mentionable`, and `flags`.

## Errors

- `401/0`: missing or wrong bot token.
- `404/10004`: unknown guild.
- `403/50001`: the bot is not a member of the guild.
- [Shared REST rules](../index.md#rest-authentication-and-responses) cover rate-limit headers and injected failures.

Sources: [guild.roles](https://github.com/logitland/logitland/blob/main/packages/discord-fake/src/rest.ts#L234),
[Role object](https://github.com/logitland/logitland/blob/main/packages/discord-fake/src/model.ts#L84).
