---
title: Fake Discord webhook REST
description: Webhook identity, execution, message changes, and interaction follow-up behavior in the local fake.
---

These routes belong to the [local fake](index.md). Prefix paths with `/api/v10`.
They use `:token` in the path and require no Authorization header.
An unknown webhook returns `404/10015`; a wrong token returns `401/50027`.
JSON body errors and injected failures follow the [shared REST rules](index.md#rest-authentication-and-responses).

## Webhook requests

| Method and path                                 | Inputs and behavior                                                                                                                  | Success and errors                                                                                                                                            | Concrete request                                                                                                        | Source                                                                                                            |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `GET /webhooks/:id/:token`                      | No body or query required.                                                                                                           | `200` Webhook.                                                                                                                                                | `GET /api/v10/webhooks/100000000000000050/local-hook-token`                                                             | [webhook.get](https://github.com/logitland/logitland/blob/main/packages/discord-fake/src/rest.ts#L448)            |
| `DELETE /webhooks/:id/:token`                   | Removes the webhook. No body.                                                                                                        | `204` without a body.                                                                                                                                         | `DELETE /api/v10/webhooks/100000000000000050/local-hook-token`                                                          | [webhook.delete](https://github.com/logitland/logitland/blob/main/packages/discord-fake/src/rest.ts#L452)         |
| `POST /webhooks/:id/:token`                     | Sends a message. Optional queries `wait=true`, `thread_id`, `with_components=true`. See body rules below.                            | `204` by default; `200` Message when `wait=true`. Empty message returns `400/50006`.                                                                          | `POST /api/v10/webhooks/100000000000000050/local-hook-token?wait=true` with `{"content":"Hello","username":"Visitor"}`. | [webhook.execute](https://github.com/logitland/logitland/blob/main/packages/discord-fake/src/rest.ts#L457)        |
| `GET /webhooks/:id/:token/messages/:message`    | Optional `thread_id` query selects a thread belonging to the webhook's parent channel.                                               | `200` Message. `404/10008` for a missing message or another author's message. Invalid thread returns `404/10003`; malformed thread ID returns `400/50035`.    | `GET /api/v10/webhooks/100000000000000050/local-hook-token/messages/100000000000000060`                                 | [webhook.message.get](https://github.com/logitland/logitland/blob/main/packages/discord-fake/src/rest.ts#L524)    |
| `PATCH /webhooks/:id/:token/messages/:message`  | Optional `thread_id`. JSON fields `content` up to 2,000 characters and `embeds` up to ten entries. Omitted fields keep their values. | `200` edited Message. Same lookup errors as GET. `400/50006` if the resulting content, poll, and embeds are empty. Components do not satisfy this edit check. | `PATCH /api/v10/webhooks/100000000000000050/local-hook-token/messages/100000000000000060` with `{"content":"Edited"}`.  | [webhook.message.edit](https://github.com/logitland/logitland/blob/main/packages/discord-fake/src/rest.ts#L529)   |
| `DELETE /webhooks/:id/:token/messages/:message` | Optional `thread_id`. Deletes only the webhook's own message.                                                                        | `204` without a body. Same lookup errors as GET.                                                                                                              | `DELETE /api/v10/webhooks/100000000000000050/local-hook-token/messages/100000000000000060`                              | [webhook.message.delete](https://github.com/logitland/logitland/blob/main/packages/discord-fake/src/rest.ts#L542) |

The `wait` and `with_components` switches accept only the literal query value `true`.
Without `with_components=true`, execution validates components but drops them before storage.
Reading messages in a thread requires its `thread_id`.

### Execute body

Execution shares [message validation](messages-threads.md#message-body) for `content`, `embeds`, `components`, `poll`, `allowed_mentions`, and `tts`.
`username` overrides the author name and accepts 1–80 characters.
Whitespace-only names fail validation. By default, names containing `clyde` or `discord` also fail, regardless of case.
`strictUsernames: false` in the TypeScript startup options disables that reserved-word execution check.
`avatar_url` and other unhandled fields have no effect.

`thread_name` accepts 1–100 characters. In a forum or media channel, it creates a post.
`applied_tags` accepts up to five snowflake strings and applies them to that new post.
The fake rejects unknown forum tags with `400/10087`.

```json
{
  "content": "A new idea",
  "thread_name": "Improve onboarding",
  "applied_tags": ["100000000000000070"]
}
```

Send that body to a webhook on a forum with the example tag, using `?wait=true`.
The returned Message's `channel_id` identifies the new thread.
The thread and its first message share an ID.
The Gateway emits `THREAD_CREATE` before `MESSAGE_CREATE`.

| Condition                                                          | Response     |
| ------------------------------------------------------------------ | ------------ |
| Forum/media webhook with neither `thread_name` nor `thread_id`     | `400/220001` |
| Forum/media webhook with both                                      | `400/220002` |
| `thread_name` on another channel, or nonempty `applied_tags` there | `400/220003` |
| `thread_id` is malformed                                           | `400/50035`  |
| `thread_id` is unknown, not a thread, or belongs to another parent | `404/10003`  |

Posting to an archived target thread unarchives it.

Sources: [execution fields and forum rules](https://github.com/logitland/logitland/blob/main/packages/discord-fake/src/rest.ts#L457),
[thread target](https://github.com/logitland/logitland/blob/main/packages/discord-fake/src/rest.ts#L187),
[forum creation](https://github.com/logitland/logitland/blob/main/packages/discord-fake/src/world.ts#L622).

## Interaction webhook branches

When `:id` equals the fake application's ID, POST, PATCH, and message DELETE use an interaction token.
The token comes from [control interactions](control-actions.md#interactions), not a seeded webhook.
It works after the target endpoint returns a successful HTTP response, for at most 15 minutes after creation.
Unknown or expired tokens return `401/50027`; unacknowledged interactions return `404/10015`.

| Request                                          | Inputs and result                                                                                                                                                   | Concrete example                                                                                                                   | Source                                                                                                                   |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `POST /webhooks/:app/:token`                     | Optional `content`, at most 2,000 characters, defaults to `""`. Numeric `flags` defaults to `0`. Returns `200` synthetic Message, regardless of `wait`.             | `POST /api/v10/webhooks/100000000000000001/interaction-token` with `{"content":"Follow-up","flags":64}`.                           | [followUp](https://github.com/logitland/logitland/blob/main/packages/discord-fake/src/interactions.ts#L236)              |
| `PATCH /webhooks/:app/:token/messages/@original` | Same fields. First edit creates the original message. Its flags default to ephemeral `64`; later zero/omitted flags preserve existing flags. Returns `200` Message. | `PATCH /api/v10/webhooks/100000000000000001/interaction-token/messages/@original` with `{"content":"Done"}`.                       | [editOriginal](https://github.com/logitland/logitland/blob/main/packages/discord-fake/src/interactions.ts#L216)          |
| `PATCH /webhooks/:app/:token/messages/:message`  | Edits an existing follow-up's content. Omitted content becomes empty. Keeps its flags. Returns `200` Message, or `404/10008`.                                       | `PATCH /api/v10/webhooks/100000000000000001/interaction-token/messages/100000000000000060` with `{"content":"Updated follow-up"}`. | [follow-up edit branch](https://github.com/logitland/logitland/blob/main/packages/discord-fake/src/interactions.ts#L220) |
| `DELETE /webhooks/:app/:token/messages/:message` | Accepts a follow-up ID or `@original`. Returns `204` without a body, or `404/10008`.                                                                                | `DELETE /api/v10/webhooks/100000000000000001/interaction-token/messages/@original`                                                 | [deleteOriginal](https://github.com/logitland/logitland/blob/main/packages/discord-fake/src/interactions.ts#L244)        |

These branches record messages on the interaction's `followUps`, outside the world's channel message list.
There is no interaction-token GET branch; GET still looks up a normal webhook.

Sources: [token lookup](https://github.com/logitland/logitland/blob/main/packages/discord-fake/src/interactions.ts#L177),
[synthetic Message fields](https://github.com/logitland/logitland/blob/main/packages/discord-fake/src/interactions.ts#L193).
