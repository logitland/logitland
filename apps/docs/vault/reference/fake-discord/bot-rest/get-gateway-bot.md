---
title: GET /gateway/bot
description: Fake Discord bot REST route for the Gateway URL, shard count, and session start limit.
---

[Fake Discord](../index.md) / [Bot REST](../bot-rest.md)

Returns the Gateway URL, one shard, and the bot's session start limit. Route name `gateway.bot`.

## Request

- Path: `/api/v10/gateway/bot`. `/api/v9` and `/api` also work.
- Auth: `Authorization: Bot <bot-token>`, with the fake's bot token (`fake-local` in examples).
- Body and query: none.

```sh
curl http://127.0.0.1:8790/api/v10/gateway/bot \
  -H 'Authorization: Bot fake-local'
```

Replace `http://127.0.0.1:8790` with the fake's printed `url`.

## Response

`200` with `url`, `shards: 1`, and `session_start_limit`.
The limit contains `total`, `remaining`, `reset_after` in milliseconds, and `max_concurrency`.
A fresh fake starts with 1,000 total and remaining sessions and concurrency one:

```json
{
  "url": "ws://127.0.0.1:8790/gateway",
  "shards": 1,
  "session_start_limit": { "total": 1000, "remaining": 1000, "reset_after": 86400000, "max_concurrency": 1 }
}
```

`reset_after` counts down from one day after startup and never drops below `0`.
Each successful IDENTIFY decrements `remaining`. The fake does not refill it automatically.
[`POST /_fake/gateway/session-limit`](../control-gateway/post-gateway-session-limit.md) changes it.

## Errors

- `401/0`: missing or wrong bot token.
- [Shared REST rules](../index.md#rest-authentication-and-responses) cover rate-limit headers and injected failures.

Sources: [gateway.bot](https://github.com/logitland/logitland/blob/main/packages/discord-fake/src/rest.ts#L208),
[session limit defaults](https://github.com/logitland/logitland/blob/main/packages/discord-fake/src/gateway.ts#L171).
