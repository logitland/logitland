---
title: 'PATCH /channels/:channel'
description: Fake Discord bot REST route that edits a thread's name, archived, or locked state.
---

[Fake Discord](../index.md) / [Messages and threads](../messages-threads.md)

Updates a thread. Route name `channel.modify`.

## Request

- Path: `/api/v10/channels/:channel`; `/api/v9` and `/api` also work.
- Auth: `Authorization: Bot <bot-token>`, with the fake's bot token (`fake-local` in examples).
- Path parameter: required thread ID `:channel`.
- Body: JSON object with optional `name` (1–100 characters), boolean `archived`, and boolean `locked`. Omitted fields stay unchanged.

```sh
curl -X PATCH http://127.0.0.1:8790/api/v10/channels/100000000000000060 \
  -H 'Authorization: Bot fake-local' \
  -H 'Content-Type: application/json' \
  -d '{"archived":true}'
```

## Response

`200` with the updated Channel. The fake emits `THREAD_UPDATE`.

## Permission rules

The bot needs Manage Threads unless the thread creator changes only `archived`.

## Errors

- `401/0`: missing or wrong bot token.
- `404/10003`: unknown channel.
- `400/50024`: the channel is not a thread.
- `403/50013`: the bot lacks Manage Threads.
- `400/50035`: invalid input.
- [Shared REST rules](../index.md#rest-authentication-and-responses) cover JSON bodies, rate-limit headers, and injected failures.

Sources: [channel.modify](https://github.com/logitland/logitland/blob/main/packages/discord-fake/src/rest.ts#L431), [thread modification](https://github.com/logitland/logitland/blob/main/packages/discord-fake/src/world.ts#L644).
