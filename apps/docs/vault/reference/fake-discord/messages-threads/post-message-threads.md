---
title: 'POST /channels/:channel/messages/:message/threads'
description: Fake Discord bot REST route that starts a thread from an existing message.
---

[Fake Discord](../index.md) / [Messages and threads](../messages-threads.md)

Starts a thread from a message in a text or announcement channel. Route name `channel.messages.thread`.

## Request

- Path: `/api/v10/channels/:channel/messages/:message/threads`. `/api/v9` and `/api` also work.
- Auth: `Authorization: Bot <bot-token>`, with the fake's bot token (`fake-local` in examples).
- Path parameters: required parent channel ID `:channel` and starter message ID `:message`.
- Body: JSON object. Send `Content-Type: application/json`.
  - `name`: required, 1–100 characters.
  - `auto_archive_duration`: optional `60`, `1440`, `4320`, or `10080` minutes. Defaults to the parent's value, or `1440`.

```sh
curl http://127.0.0.1:8790/api/v10/channels/100000000000000020/messages/100000000000000060/threads \
  -H 'Authorization: Bot fake-local' \
  -H 'Content-Type: application/json' \
  -d '{"name":"Discussion"}'
```

Replace `http://127.0.0.1:8790` with the fake's printed `url`.
The example channel comes from [`POST /_fake/channels`](../control-seeding/post-channels.md) with an explicit ID.
Messages receive generated IDs. Replace the message ID with one returned by an earlier request.

## Response

`201` with the thread Channel. Its ID equals the starter message's ID.
A text parent creates a public thread, type `11`. An announcement parent creates type `10`.
The bot becomes the thread's owner and first member.

The fake emits `THREAD_CREATE`, then `MESSAGE_UPDATE` for the starter message, which gains the thread.

## Errors

- `401/0`: missing or wrong bot token.
- `404/10003`: unknown channel.
- `403/50013`: the bot lacks Create Public Threads.
- `400/50024`: the parent is not a text or announcement channel.
- `400/50035`: missing or invalid `name`, or an invalid `auto_archive_duration`.
- `404/10008`: unknown message.
- `400/160004`: the message already has a thread.
- [Shared REST rules](../index.md#rest-authentication-and-responses) cover JSON bodies, rate-limit headers, and injected failures.

Sources: [channel.messages.thread](https://github.com/logitland/logitland/blob/main/packages/discord-fake/src/rest.ts#L377),
[message threads](https://github.com/logitland/logitland/blob/main/packages/discord-fake/src/world.ts#L600).
