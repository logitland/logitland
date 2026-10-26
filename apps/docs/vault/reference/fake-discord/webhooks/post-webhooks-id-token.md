---
title: 'POST /webhooks/:id/:token'
description: Fake Discord webhook REST route for /webhooks/:id/:token.
---

[Fake Discord](../index.md) / [Webhooks](../webhooks.md)

Handles a webhook route using the token in the path. No Authorization header is required.

## Request

- Method and path: `POST /webhooks/:id/:token`.
- Auth: no Authorization header; the webhook token is in the path.
- Inputs and behavior: Sends a message. Optional queries `wait=true`, `thread_id`, `with_components=true`. See body rules below.

## Response

`204` by default; `200` Message when `wait=true`. Empty message returns `400/50006`.

## Example

`POST /api/v10/webhooks/100000000000000050/local-hook-token?wait=true` with `{"content":"Hello","username":"Visitor"}`.

## Source

[webhook.execute](https://github.com/logitland/logitland/blob/main/packages/discord-fake/src/rest.ts#L457)

The `wait` and `with_components` switches accept only the literal query value `true`. Without `with_components=true`, execution validates components but drops them before storage. Reading messages in a thread requires its `thread_id`.

## Execute body

Execution shares [message validation](../messages-threads/post-channel-messages.md#message-body) for `content`, `embeds`, `components`, `poll`, `allowed_mentions`, and `tts`. `username` overrides the author name and accepts 1–80 characters. Whitespace-only names fail validation. By default, names containing `clyde` or `discord` also fail, regardless of case. `strictUsernames: false` in the TypeScript startup options disables that reserved-word execution check. `avatar_url` and other unhandled fields have no effect.

`thread_name` accepts 1–100 characters. In a forum or media channel, it creates a post. `applied_tags` accepts up to five snowflake strings and applies them to that new post. The fake rejects unknown forum tags with `400/10087`.

```json
{
  "content": "A new idea",
  "thread_name": "Improve onboarding",
  "applied_tags": ["100000000000000070"]
}
```

Send that body to a webhook on a forum with the example tag, using `?wait=true`. The returned Message's `channel_id` identifies the new thread. The thread and its first message share an ID. The Gateway emits `THREAD_CREATE` before `MESSAGE_CREATE`.

| Condition                                                          | Response     |
| ------------------------------------------------------------------ | ------------ |
| Forum/media webhook with neither `thread_name` nor `thread_id`     | `400/220001` |
| Forum/media webhook with both                                      | `400/220002` |
| `thread_name` on another channel, or nonempty `applied_tags` there | `400/220003` |
| `thread_id` is malformed                                           | `400/50035`  |
| `thread_id` is unknown, not a thread, or belongs to another parent | `404/10003`  |

Posting to an archived target thread unarchives it.

Sources: [execution fields and forum rules](https://github.com/logitland/logitland/blob/main/packages/discord-fake/src/rest.ts#L457), [thread target](https://github.com/logitland/logitland/blob/main/packages/discord-fake/src/rest.ts#L187), [forum creation](https://github.com/logitland/logitland/blob/main/packages/discord-fake/src/world.ts#L622).

The `wait` and `with_components` switches accept only the literal query value `true`. Without `with_components=true`, execution validates components but drops them before storage. Reading messages in a thread requires its `thread_id`.

## Execute body

Execution shares [message validation](../messages-threads/post-channel-messages.md#message-body) for `content`, `embeds`, `components`, `poll`, `allowed_mentions`, and `tts`. `username` overrides the author name and accepts 1–80 characters. Whitespace-only names fail validation. By default, names containing `clyde` or `discord` also fail, regardless of case. `strictUsernames: false` in the TypeScript startup options disables that reserved-word execution check. `avatar_url` and other unhandled fields have no effect.

`thread_name` accepts 1–100 characters. In a forum or media channel, it creates a post. `applied_tags` accepts up to five snowflake strings and applies them to that new post. The fake rejects unknown forum tags with `400/10087`.

```json
{
  "content": "A new idea",
  "thread_name": "Improve onboarding",
  "applied_tags": ["100000000000000070"]
}
```

Send that body to a webhook on a forum with the example tag, using `?wait=true`. The returned Message's `channel_id` identifies the new thread. The thread and its first message share an ID. The Gateway emits `THREAD_CREATE` before `MESSAGE_CREATE`.

| Condition                                                          | Response     |
| ------------------------------------------------------------------ | ------------ |
| Forum/media webhook with neither `thread_name` nor `thread_id`     | `400/220001` |
| Forum/media webhook with both                                      | `400/220002` |
| `thread_name` on another channel, or nonempty `applied_tags` there | `400/220003` |
| `thread_id` is malformed                                           | `400/50035`  |
| `thread_id` is unknown, not a thread, or belongs to another parent | `404/10003`  |

Posting to an archived target thread unarchives it.

Sources: [execution fields and forum rules](https://github.com/logitland/logitland/blob/main/packages/discord-fake/src/rest.ts#L457), [thread target](https://github.com/logitland/logitland/blob/main/packages/discord-fake/src/rest.ts#L187), [forum creation](https://github.com/logitland/logitland/blob/main/packages/discord-fake/src/world.ts#L622).
