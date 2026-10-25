---
title: Fake Discord control actions
description: Simulate people, message changes, threads, roles, slash commands, and button clicks in local tests.
---

These [local control endpoints](control-seeding.md) have **no authentication**.
Every successful request returns `200` JSON. Input and world errors return `400 {"error":"message"}`.
Message and thread IDs in examples stand for IDs returned by earlier requests.
These actions let tests change the world directly; they do not use bot REST permission checks.

## People, messages, and threads

| Method and path                                | Required/default inputs                                                                                                           | Success and route errors                                                                                                                   | Concrete example                                                                                                | Source                                                                                                           |
| ---------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `POST /_fake/messages`                         | Required strings `channel`, `as` (existing user ID), `content`. Optional `reply_to`, numeric `type`, `thread_name`, array `tags`. | Message. A forum/media channel requires `thread_name` and creates a post. Unknown user/channel or missing forum thread name returns `400`. | `{"channel":"100000000000000020","as":"100000000000000030","content":"Hello"}`                                  | [messages](https://github.com/logitland/logitland/blob/main/packages/discord-fake/src/control.ts#L180)           |
| `GET /_fake/messages`                          | Required query `channel`. Optional `webhook=1` restricts results to webhook messages.                                             | `{messages: Message[]}`, oldest first, with full content. Unknown channel or absent query returns `400`.                                   | `GET /_fake/messages?channel=100000000000000020&webhook=1`                                                      | [message reads](https://github.com/logitland/logitland/blob/main/packages/discord-fake/src/control.ts#L214)      |
| `PATCH /_fake/messages/:channel/:id`           | Required string `content`. Both path IDs contain digits.                                                                          | Edited Message. Missing message returns `400`, error `Unknown Message`.                                                                    | `PATCH /_fake/messages/100000000000000020/100000000000000060` with `{"content":"Edited by Alice"}`.             | [message edit](https://github.com/logitland/logitland/blob/main/packages/discord-fake/src/control.ts#L203)       |
| `DELETE /_fake/messages/:channel/:id`          | Digit-only path IDs. No body required.                                                                                            | `{"ok":true}`. Missing message returns `400`, error `Unknown Message`.                                                                     | `DELETE /_fake/messages/100000000000000020/100000000000000060`                                                  | [message delete](https://github.com/logitland/logitland/blob/main/packages/discord-fake/src/control.ts#L205)     |
| `POST /_fake/messages/bulk-delete`             | Required `channel` string and `ids` array.                                                                                        | `{"ok":true}`. Emits `MESSAGE_DELETE_BULK`.                                                                                                | `{"channel":"100000000000000020","ids":["100000000000000060","100000000000000061"]}`                            | [bulk delete](https://github.com/logitland/logitland/blob/main/packages/discord-fake/src/control.ts#L194)        |
| `POST /_fake/threads`                          | Required strings `channel`, `message`, `name`. Optional existing user ID `as`; defaults to the bot.                               | Thread Channel. Wrong parent type, missing starter, or existing thread returns `400`.                                                      | `{"channel":"100000000000000020","message":"100000000000000060","name":"Discussion","as":"100000000000000030"}` | [thread creation](https://github.com/logitland/logitland/blob/main/packages/discord-fake/src/control.ts#L225)    |
| `PATCH /_fake/threads/:id`                     | Digit-only thread ID. Optional string `name`, booleans `archived` and `locked`, array `tags`. Omitted fields stay unchanged.      | Updated Channel. Unknown channel or non-thread returns `400`.                                                                              | `PATCH /_fake/threads/100000000000000060` with `{"archived":true,"locked":true}`.                               | [thread edit](https://github.com/logitland/logitland/blob/main/packages/discord-fake/src/control.ts#L227)        |
| `DELETE /_fake/threads/:id`                    | Digit-only thread ID. No body required.                                                                                           | `{"ok":true}`. Removes the thread, its messages, and memberships. Unknown channel or non-thread returns `400`.                             | `DELETE /_fake/threads/100000000000000060`                                                                      | [thread deletion](https://github.com/logitland/logitland/blob/main/packages/discord-fake/src/control.ts#L239)    |
| `POST /_fake/members/:guild/:user/roles/:role` | Digit-only IDs. Adds the role unless JSON `remove` is exactly `true`.                                                             | `{"ok":true}`. Unknown guild/member/role returns `400`.                                                                                    | `POST /_fake/members/100000000000000010/100000000000000030/roles/100000000000000040` with `{"remove":false}`.   | [member role change](https://github.com/logitland/logitland/blob/main/packages/discord-fake/src/control.ts#L248) |

`reply_to` adds a message reference and defaults the message type to `19`.
Other numeric `type` values can simulate system messages.
Forum posts use `tags` as the applied tag IDs.
Control thread edits pass tags straight to the world without REST's tag validation.

Sources: [person message behavior](https://github.com/logitland/logitland/blob/main/packages/discord-fake/src/fake.ts#L342),
[world message mutations](https://github.com/logitland/logitland/blob/main/packages/discord-fake/src/world.ts#L477),
[thread mutations](https://github.com/logitland/logitland/blob/main/packages/discord-fake/src/world.ts#L644).

## Interactions

| Method and path            | Inputs and result                                                                                                                                                                         | Concrete example                                                                                                                                                                                        | Source                                                                                                         |
| -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `POST /_fake/interactions` | Builds a signed interaction and POSTs it to the target endpoint. Returns `{status,body,interaction}`, where status/body belong to the target response. Control HTTP status remains `200`. | `{"user":"100000000000000030","guild":"100000000000000010","channel":"100000000000000020","command":{"name":"mirror","subcommand":"agree"},"endpoint":"http://127.0.0.1:8787/v1/discord/interactions"}` | [send interaction](https://github.com/logitland/logitland/blob/main/packages/discord-fake/src/control.ts#L257) |
| `GET /_fake/interactions`  | No inputs. Returns `{interactions: InteractionRecord[]}`.                                                                                                                                 | `GET /_fake/interactions`                                                                                                                                                                               | [interaction log](https://github.com/logitland/logitland/blob/main/packages/discord-fake/src/control.ts#L274)  |

POST requires a string `user`, even for a ping.
Supply one of `command`, `button`, or `ping: true`.
`command` contains `name` and optional `subcommand`.
`button` contains `customId` and optional `messageId`.
For example, this body simulates a button click:

```json
{
  "user": "100000000000000030",
  "button": { "customId": "agree", "messageId": "100000000000000060" }
}
```

Optional `guild` defaults to the first guild.
Optional `channel` defaults to the guild's first text channel, or `null` if none exists.
Optional `endpoint` defaults to `application.interactions_endpoint_url`.
`signature` accepts `valid` (default), `invalid`, or `missing`.
`timestamp` defaults to the current epoch time in seconds.

The fake signs `timestamp + body` with Ed25519 and sends Discord signature headers.
`missing` omits both signature headers. `invalid` corrupts the signature.
The outbound request times out after 15 seconds.
No guild, no endpoint, an unknown non-ping member, or no interaction action returns control `400`.
Transport failures also return control `400` with the failure message.

Each record contains `id`, `token`, `type`, `user`, `payload`, numeric `createdAt`, `acknowledged`, `response`, and `followUps`.
Any target `2xx` response marks it acknowledged.
Use its token with the [interaction webhook branches](webhooks.md#interaction-webhook-branches).

Sources: [interaction construction and defaults](https://github.com/logitland/logitland/blob/main/packages/discord-fake/src/interactions.ts#L84),
[signature and response handling](https://github.com/logitland/logitland/blob/main/packages/discord-fake/src/interactions.ts#L149),
[record fields](https://github.com/logitland/logitland/blob/main/packages/discord-fake/src/interactions.ts#L39).
