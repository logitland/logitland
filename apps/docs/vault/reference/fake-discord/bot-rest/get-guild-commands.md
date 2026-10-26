---
title: 'GET /applications/:app/guilds/:guild/commands'
description: Fake Discord bot REST route that lists a guild's registered application commands.
---

[Fake Discord](../index.md) / [Bot REST](../bot-rest.md)

Lists the guild commands registered for the fake application. Route name `commands.list`.

## Request

- Path: `/api/v10/applications/:app/guilds/:guild/commands`. `/api/v9` and `/api` also work.
- Auth: `Authorization: Bot <bot-token>`, with the fake's bot token (`fake-local` in examples).
- Path parameters: `:app` must equal the fake's application ID. `:guild` must exist.
- Body and query: none.

```sh
curl http://127.0.0.1:8790/api/v10/applications/100000000000000001/guilds/100000000000000010/commands \
  -H 'Authorization: Bot fake-local'
```

Replace `http://127.0.0.1:8790` with the fake's printed `url`.
The example application ID comes from `--application-id 100000000000000001`.
The guild comes from [`POST /_fake/guilds`](../control-seeding/post-guilds.md) with an explicit ID.

## Response

`200` with the ApplicationCommand array, or `[]` before [registration](put-guild-commands.md).

## Errors

- `401/0`: missing or wrong bot token.
- `403/50001`: `:app` is a different application.
- `404/10004`: unknown guild.
- [Shared REST rules](../index.md#rest-authentication-and-responses) cover rate-limit headers and injected failures.

Sources: [commands.list](https://github.com/logitland/logitland/blob/main/packages/discord-fake/src/rest.ts#L271),
[ApplicationCommand object](https://github.com/logitland/logitland/blob/main/packages/discord-fake/src/model.ts#L219).
