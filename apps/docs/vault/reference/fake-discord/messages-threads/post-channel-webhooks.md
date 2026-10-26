---
title: 'POST /channels/:channel/webhooks'
description: Fake Discord bot REST route that creates a webhook on a channel.
---

[Fake Discord](../index.md) / [Messages and threads](../messages-threads.md)

Creates a webhook on a text-like channel. Route name `channel.webhooks.create`.

## Request

- Path: `/api/v10/channels/:channel/webhooks`. `/api/v9` and `/api` also work.
- Auth: `Authorization: Bot <bot-token>`, with the fake's bot token (`fake-local` in examples).
- Path parameter: required channel ID `:channel`.
- Body: JSON object with required `name`, 1–80 characters. Send `Content-Type: application/json`.

```sh
curl http://127.0.0.1:8790/api/v10/channels/100000000000000020/webhooks \
  -H 'Authorization: Bot fake-local' \
  -H 'Content-Type: application/json' \
  -d '{"name":"Mirror"}'
```

Replace `http://127.0.0.1:8790` with the fake's printed `url`.
The example channel comes from [`POST /_fake/channels`](../control-seeding/post-channels.md) with an explicit ID.

## Response

`200` with the Webhook, including its `token`, plus the bot User as `user`.
Use the ID and token with the [webhook routes](../webhooks.md).

## Errors

- `401/0`: missing or wrong bot token.
- `404/10003`: unknown channel.
- `403/50013`: the bot lacks Manage Webhooks in the channel.
- `400/50024`: the channel is a category or thread.
- `400/50035`: missing or invalid `name`, or a name containing `clyde` or `discord` in any case.
- `400/30007`: the channel already has 15 webhooks.
- [Shared REST rules](../index.md#rest-authentication-and-responses) cover JSON bodies, rate-limit headers, and injected failures.

Sources: [channel.webhooks.create](https://github.com/logitland/logitland/blob/main/packages/discord-fake/src/rest.ts#L318),
[Webhook object](https://github.com/logitland/logitland/blob/main/packages/discord-fake/src/model.ts#L161).
