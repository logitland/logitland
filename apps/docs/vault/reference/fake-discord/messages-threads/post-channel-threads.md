---
title: 'POST /channels/:channel/threads'
description: Fake Discord bot REST route that creates a thread without a starter message, private by default.
---

[Fake Discord](../index.md) / [Messages and threads](../messages-threads.md)

Creates a thread without a starter message. Route name `channel.threads.create`.

## Request

- Path: `/api/v10/channels/:channel/threads`. `/api/v9` and `/api` also work.
- Auth: `Authorization: Bot <bot-token>`, with the fake's bot token (`fake-local` in examples).
- Path parameter: required parent channel ID `:channel`.
- Body: JSON object. Send `Content-Type: application/json`.
  - `name`: required, 1–100 characters.
  - `type`: optional, defaults to private thread `12`. Types `11` and `12` fit text parents. Type `10` fits announcement parents.
  - `auto_archive_duration`: optional `60`, `1440`, `4320`, or `10080` minutes. Defaults to the parent's value, or `1440`.
  - `invitable`: optional boolean for private threads. Defaults to `true`.

```sh
curl http://127.0.0.1:8790/api/v10/channels/100000000000000020/threads \
  -H 'Authorization: Bot fake-local' \
  -H 'Content-Type: application/json' \
  -d '{"name":"Private discussion","type":12,"invitable":false}'
```

Replace `http://127.0.0.1:8790` with the fake's printed `url`.
The example channel comes from [`POST /_fake/channels`](../control-seeding/post-channels.md) with an explicit ID.

## Response

`201` with the thread Channel, which has a generated ID and no starter message.
The bot becomes the thread's owner and first member. The fake emits `THREAD_CREATE`.

## Errors

- `401/0`: missing or wrong bot token.
- `404/10003`: unknown channel.
- `400/50035`: a `type` other than `10`, `11`, or `12`, a missing or invalid `name`, or an invalid `auto_archive_duration`.
- `403/50013`: the bot lacks Create Private Threads for type `12`, or Create Public Threads otherwise.
- `400/50024`: the thread type does not fit the parent channel.
- [Shared REST rules](../index.md#rest-authentication-and-responses) cover JSON bodies, rate-limit headers, and injected failures.

Sources: [channel.threads.create](https://github.com/logitland/logitland/blob/main/packages/discord-fake/src/rest.ts#L395),
[thread creation](https://github.com/logitland/logitland/blob/main/packages/discord-fake/src/world.ts#L568).
