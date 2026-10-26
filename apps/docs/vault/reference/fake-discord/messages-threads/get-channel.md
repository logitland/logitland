---
title: 'GET /channels/:channel'
description: Fake Discord bot REST route that returns one channel or thread.
---

[Fake Discord](../index.md) / [Messages and threads](../messages-threads.md)

Returns one channel or thread. Route name `channel.get`.

## Request

- Path: `/api/v10/channels/:channel`. `/api/v9` and `/api` also work.
- Auth: `Authorization: Bot <bot-token>`, with the fake's bot token (`fake-local` in examples).
- Path parameter: required channel or thread ID `:channel`.
- Body and query: none.

```sh
curl http://127.0.0.1:8790/api/v10/channels/100000000000000020 \
  -H 'Authorization: Bot fake-local'
```

Replace `http://127.0.0.1:8790` with the fake's printed `url`.
The example channel comes from [`POST /_fake/channels`](../control-seeding/post-channels.md) with an explicit ID.
`--seed dev` generates different IDs.

## Response

`200` with the Channel: IDs, type, name, parent, position, overwrites, and optional thread metadata or forum tags.

## Errors

- `401/0`: missing or wrong bot token.
- `404/10003`: unknown channel.
- [Shared REST rules](../index.md#rest-authentication-and-responses) cover rate-limit headers and injected failures.

This route does not check the bot's channel permissions.

Sources: [channel.get](https://github.com/logitland/logitland/blob/main/packages/discord-fake/src/rest.ts#L316),
[Channel object](https://github.com/logitland/logitland/blob/main/packages/discord-fake/src/model.ts#L138).
