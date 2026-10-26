---
title: 'GET /channels/:channel/messages'
description: Fake Discord bot REST route that pages through a channel's messages, newest first, with Message Content filtering.
---

[Fake Discord](../index.md) / [Messages and threads](../messages-threads.md)

Returns one page of a channel's or thread's messages, newest first. Route name `channel.messages.list`.

## Request

- Path: `/api/v10/channels/:channel/messages`. `/api/v9` and `/api` also work.
- Auth: `Authorization: Bot <bot-token>`, with the fake's bot token (`fake-local` in examples).
- Path parameter: required channel or thread ID `:channel`.
- Query `limit`: integer 1–100, default `50`.
- Query cursor: at most one of `before`, `after`, or `around`, each a snowflake.

```sh
curl 'http://127.0.0.1:8790/api/v10/channels/100000000000000020/messages?limit=10&before=100000000000000060' \
  -H 'Authorization: Bot fake-local'
```

Replace `http://127.0.0.1:8790` with the fake's printed `url`.
The example channel comes from [`POST /_fake/channels`](../control-seeding/post-channels.md) with an explicit ID.
Messages receive generated IDs. Replace the cursor with an ID returned by an earlier request.

## Response

`200` with a Message array, newest first.

- `before` returns the messages just older than the cursor.
- `after` selects the messages closest to the cursor, then returns that page newest first.
- `around` returns up to half the limit before the cursor, then the cursor and newer messages.

Without the application Message Content flag, the fake hides other people's content, embeds, attachments, components, and polls.
The bot's own messages and messages mentioning the bot keep those fields.
[`PATCH /_fake/application`](../control-seeding/patch-application.md) sets the flag.
[`GET /_fake/messages`](../control-actions/get-messages.md) always returns full content.

## Errors

- `401/0`: missing or wrong bot token.
- `404/10003`: unknown channel.
- `403/50001`: the bot lacks View Channel.
- `400/50035`: more than one cursor, a non-snowflake cursor, or an invalid `limit`.
- Without Read Message History, the route returns `200` with `[]`.
- [Shared REST rules](../index.md#rest-authentication-and-responses) cover rate-limit headers and injected failures.

Sources: [channel.messages.list](https://github.com/logitland/logitland/blob/main/packages/discord-fake/src/rest.ts#L331),
[pagination](https://github.com/logitland/logitland/blob/main/packages/discord-fake/src/world.ts#L517),
[REST content filtering](https://github.com/logitland/logitland/blob/main/packages/discord-fake/src/fake.ts#L281).
