---
title: Fake Discord messages and threads
description: Bot channel reads, message creation, webhook creation, and thread routes.
---

These [local fake](index.md) routes require `Authorization: Bot fake-local`.
Prefix paths with `/api/v10` and send mutation bodies as JSON.
Unknown channels return `404/10003`. Permission failures return `403/50013`, unless a row specifies Missing Access.
Invalid fields return `400/50035`; [shared REST errors](index.md#rest-authentication-and-responses) also apply.

## Channels and messages

| Method and path                    | Required and optional inputs                                                                                              | Success and route errors                                                                                                                                                                                         | Concrete request                                                                              | Source                                                                                                             |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `GET /channels/:channel`           | Channel ID only.                                                                                                          | `200` Channel.                                                                                                                                                                                                   | `GET /api/v10/channels/100000000000000020`                                                    | [channel.get](https://github.com/logitland/logitland/blob/main/packages/discord-fake/src/rest.ts#L316)             |
| `POST /channels/:channel/webhooks` | Required `name`, 1–80 characters.                                                                                         | `200` Webhook plus bot `user`. Needs Manage Webhooks. Category/thread returns `400/50024`; 15 existing hooks returns `400/30007`. Names containing `clyde` or `discord`, case-insensitively, return `400/50035`. | `POST /api/v10/channels/100000000000000020/webhooks` with `{"name":"Mirror"}`.                | [channel.webhooks.create](https://github.com/logitland/logitland/blob/main/packages/discord-fake/src/rest.ts#L318) |
| `GET /channels/:channel/messages`  | Query `limit` defaults to `50`, integer 1–100. Optional snowflake cursor `before`, `after`, or `around`; use at most one. | `200` Message array, newest first. Missing View Channel returns `403/50001`; missing Read Message History returns `[]`.                                                                                          | `GET /api/v10/channels/100000000000000020/messages?limit=10&before=100000000000000060`        | [channel.messages.list](https://github.com/logitland/logitland/blob/main/packages/discord-fake/src/rest.ts#L331)   |
| `POST /channels/:channel/messages` | JSON object with content or another accepted message body. See below.                                                     | `200` Message. Needs Send Messages, or Send Messages in Threads. Empty body returns `400/50006`; direct forum/media posts return `400/40058`; categories return `400/50024`.                                     | `POST /api/v10/channels/100000000000000020/messages` with `{"content":"Hello from the bot"}`. | [channel.messages.create](https://github.com/logitland/logitland/blob/main/packages/discord-fake/src/rest.ts#L352) |

`after` selects the messages closest to the cursor, then returns that page newest first.
Without the application Message Content flag, message reads hide other people's content, embeds, attachments, components, and polls.
The bot's own messages and messages mentioning the bot keep their content.

Sources: [pagination](https://github.com/logitland/logitland/blob/main/packages/discord-fake/src/world.ts#L517),
[REST content filtering](https://github.com/logitland/logitland/blob/main/packages/discord-fake/src/fake.ts#L286).

### Message body

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

Sources: [message validators](https://github.com/logitland/logitland/blob/main/packages/discord-fake/src/rest.ts#L62),
[body and reference checks](https://github.com/logitland/logitland/blob/main/packages/discord-fake/src/rest.ts#L161).

Polls need `question.text` of 1–300 characters and 1–10 answers.
Each answer needs `poll_media.text` of 1–55 characters.
`duration` defaults to 24 hours and accepts integers 1–768.
`allow_multiselect` defaults to `false`; the fake sets `layout_type: 1` and empty, unfinalized results.

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

Source: [poll validation](https://github.com/logitland/logitland/blob/main/packages/discord-fake/src/rest.ts#L127).

## Threads

| Method and path                                     | Required and optional inputs                                                                                                                                                                                              | Success and route errors                                                                                                                                                                                      | Concrete request                                                                                                      | Source                                                                                                                   |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `POST /channels/:channel/messages/:message/threads` | Required `name`, 1–100 characters. Optional `auto_archive_duration` of `60`, `1440`, `4320`, or `10080` minutes; defaults to the parent's value or `1440`.                                                                | `201` Channel, with the starter message's ID. Needs Create Public Threads. Text/announcement parents only (`400/50024` otherwise). Unknown message returns `404/10008`; existing thread returns `400/160004`. | `POST /api/v10/channels/100000000000000020/messages/100000000000000060/threads` with `{"name":"Discussion"}`.         | [channel.messages.thread](https://github.com/logitland/logitland/blob/main/packages/discord-fake/src/rest.ts#L377)       |
| `POST /channels/:channel/threads`                   | Required `name`, 1–100 characters. `type` defaults to private thread `12`. Types `11` and `12` fit text parents; `10` fits announcement parents. Same archive durations as above. Private `invitable` defaults to `true`. | `201` Channel without a starter message. Needs Create Private Threads for `12`, otherwise Create Public Threads. Wrong parent/type returns `400/50024`.                                                       | `POST /api/v10/channels/100000000000000020/threads` with `{"name":"Private discussion","type":12,"invitable":false}`. | [channel.threads.create](https://github.com/logitland/logitland/blob/main/packages/discord-fake/src/rest.ts#L395)        |
| `PUT /channels/:channel/thread-members/:user`       | Thread and guild member IDs. No body.                                                                                                                                                                                     | `204` without a body. Needs Send Messages in Threads. Non-thread returns `400/50024`; archived thread `400/50083`; unknown member `404/10007`.                                                                | `PUT /api/v10/channels/100000000000000060/thread-members/100000000000000030`                                          | [channel.thread_members.add](https://github.com/logitland/logitland/blob/main/packages/discord-fake/src/rest.ts#L426)    |
| `DELETE /channels/:channel/thread-members/:user`    | Thread and user IDs. No body.                                                                                                                                                                                             | `204` without a body, including absent membership. Same permission/type/archive checks as addition.                                                                                                           | `DELETE /api/v10/channels/100000000000000060/thread-members/100000000000000030`                                       | [channel.thread_members.remove](https://github.com/logitland/logitland/blob/main/packages/discord-fake/src/rest.ts#L427) |
| `PATCH /channels/:channel`                          | JSON object. Optional `name` of 1–100 characters, boolean `archived`, boolean `locked`. Omitted fields stay unchanged.                                                                                                    | `200` updated Channel. Threads only (`400/50024` otherwise). Needs Manage Threads except when the creator changes only `archived`.                                                                            | `PATCH /api/v10/channels/100000000000000060` with `{"archived":true}`.                                                | [channel.modify](https://github.com/logitland/logitland/blob/main/packages/discord-fake/src/rest.ts#L431)                |

The bot becomes the first member of a thread it creates.
Creating a message thread emits `THREAD_CREATE` and updates its starter message.
Modifying a thread emits `THREAD_UPDATE`.

Sources: [thread creation and membership](https://github.com/logitland/logitland/blob/main/packages/discord-fake/src/world.ts#L537),
[message threads](https://github.com/logitland/logitland/blob/main/packages/discord-fake/src/world.ts#L600).
