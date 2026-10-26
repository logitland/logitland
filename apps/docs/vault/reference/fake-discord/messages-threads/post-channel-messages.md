---
title: 'POST /channels/:channel/messages'
description: Fake Discord bot REST route that posts a bot message, with content, embeds, components, poll, and mention validation.
---

[Fake Discord](../index.md) / [Messages and threads](../messages-threads.md)

Posts a message as the bot in a channel or thread. Route name `channel.messages.create`.

## Request

- Path: `/api/v10/channels/:channel/messages`. `/api/v9` and `/api` also work.
- Auth: `Authorization: Bot <bot-token>`, with the fake's bot token (`fake-local` in examples).
- Path parameter: required channel or thread ID `:channel`.
- Body: a JSON object following the [message body](#message-body) rules. Send `Content-Type: application/json`.

```sh
curl http://127.0.0.1:8790/api/v10/channels/100000000000000020/messages \
  -H 'Authorization: Bot fake-local' \
  -H 'Content-Type: application/json' \
  -d '{"content":"Hello from the bot"}'
```

Replace `http://127.0.0.1:8790` with the fake's printed `url`.
The example channel comes from [`POST /_fake/channels`](../control-seeding/post-channels.md) with an explicit ID.

## Message body

`content` is optional, with at most 2,000 characters.
A nonempty `content`, poll, embeds array, or components array makes a nonempty message.
The validator also accepts a `sticker_ids` array as a body, but does not store stickers.
`tts` defaults to `false`.
`message_reference` accepts optional snowflake `message_id`, `channel_id`, and `guild_id` fields.

`embeds` accepts at most ten entries. The fake does not validate each embed's contents.
`components` accepts at most five action rows, each with `type: 1` and 1–5 child components.
Buttons use styles 1–5 and need a label or emoji.
Labels have at most 80 characters. Non-link buttons need a nonempty `custom_id` of at most 100 characters.
Style `5` needs `url` and forbids `custom_id`.

`allowed_mentions` accepts string arrays `parse`, `users`, and `roles`, plus boolean `replied_user`.
`parse` values must be `users`, `roles`, or `everyone`.

Polls need `question.text` of 1–300 characters and 1–10 answers.
Each answer needs `poll_media.text` of 1–55 characters.
`duration` is in hours. It defaults to 24 and accepts integers 1–768.
`allow_multiselect` defaults to `false`. The fake sets `layout_type: 1` and empty, unfinalized results.

```json
{
  "poll": {
    "question": { "text": "Which channel?" },
    "answers": [{ "poll_media": { "text": "General" } }],
    "duration": 24,
    "allow_multiselect": false
  }
}
```

[`POST /webhooks/:id/:token`](../webhooks/post-webhooks-id-token.md) uses the same rules for these fields.

## Response

`200` with the stored Message. It emits `MESSAGE_CREATE` on the Gateway.

## Errors

- `401/0`: missing or wrong bot token.
- `404/10003`: unknown channel.
- `403/50013`: the bot lacks Send Messages, or Send Messages in Threads for a thread.
- `400/40058`: the channel is a forum or media channel. Post there through a [webhook](../webhooks/post-webhooks-id-token.md) with `thread_name`.
- `400/50024`: the channel is a category.
- `400/50109`: the body is not a JSON object.
- `400/50035`: a field breaks the rules above. The response names the field in `errors`.
- `400/50006`: the message is empty.
- [Shared REST rules](../index.md#rest-authentication-and-responses) cover JSON bodies, rate-limit headers, and injected failures.

Sources: [channel.messages.create](https://github.com/logitland/logitland/blob/main/packages/discord-fake/src/rest.ts#L352),
[message validators](https://github.com/logitland/logitland/blob/main/packages/discord-fake/src/rest.ts#L62),
[poll validation](https://github.com/logitland/logitland/blob/main/packages/discord-fake/src/rest.ts#L127),
[body and reference checks](https://github.com/logitland/logitland/blob/main/packages/discord-fake/src/rest.ts#L161).
