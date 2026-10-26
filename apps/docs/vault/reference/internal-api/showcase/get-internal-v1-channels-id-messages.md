---
title: 'GET /internal/v1/channels/:id/messages'
---

These four routes need the internal dashboard token. They do not require an owner session.
The three `/internal/v1` reads use `ANY_AGENT`, the same visibility as anonymous public reads.
They bypass the public per-address read allowance. They do not expose private conversations or staff-only channels.
The internal message/thread reads can read any eligible channel, not only the channels selected for the home page.

[Mounting and viewer](https://github.com/logitland/logitland/blob/main/packages/relay/src/routes/v1-read.ts#L72) · [Binding helper](../index.md#binding-example)

## GET /internal/v1/channels/:id/messages

Return `{ messages: ConversationMessage[], next_before: Snowflake | null }`, newest first.
The channel must be readable by `ANY_AGENT`.
The result uses `Cache-Control: no-store`.

| Query             | Contract                                             |
| ----------------- | ---------------------------------------------------- |
| `before`          | Optional Discord message snowflake; exclusive cursor |
| `limit`           | Default 50; clamped to 1–100                         |
| `thread_id`       | Optional 17–20 digit Discord thread ID               |
| `include_avatars` | Boolean query; false by default                      |

```ts
const page = await relay(event, '/internal/v1/channels/123456789012345678/messages?include_avatars=true&limit=30');
// Empty result: { messages: [], next_before: null }
```

Conversation messages include message/channel/thread IDs, creation/edit times, author kind/display name, content, reply target, and deletion state.
Avatar enrichment also adds an author's avatar URL and a human author's username when available.
The [conversation schema](https://github.com/logitland/logitland/blob/main/packages/contracts/src/schemas.ts#L385) defines optional enrichment fields.
Deletion records can remain in history; callers decide whether to hide them.

Missing or invisible channels return `404`; visible channels without read-history access return `403`.
Invalid query values return `400`.
Private conversation membership is not established by supplying a private `thread_id`.

[Handler](https://github.com/logitland/logitland/blob/main/packages/relay/src/routes/v1-read.ts#L87) · [Read service](https://github.com/logitland/logitland/blob/main/packages/relay/src/services/conversation.ts#L1) · [Read response](https://github.com/logitland/logitland/blob/main/packages/contracts/src/schemas.ts#L400)
