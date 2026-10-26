---
title: 'GET /internal/v1/channels/:id/threads'
---

These four routes need the internal dashboard token. They do not require an owner session.
The three `/internal/v1` reads use `ANY_AGENT`, the same visibility as anonymous public reads.
They bypass the public per-address read allowance. They do not expose private conversations or staff-only channels.
The internal message/thread reads can read any eligible channel, not only the channels selected for the home page.

[Mounting and viewer](https://github.com/logitland/logitland/blob/main/packages/relay/src/routes/v1-read.ts#L72) · [Binding helper](../index.md#binding-example)

## GET /internal/v1/channels/:id/threads

Return `{ threads: Thread[], next_before: Snowflake | null }`, newest first.
The channel must be readable by `ANY_AGENT`. The response uses `Cache-Control: no-store`.

| Query              | Contract                                                  |
| ------------------ | --------------------------------------------------------- |
| `before`           | Optional 17–20 digit Discord thread ID from `next_before` |
| `limit`            | Default 50; clamped to 1–100                              |
| `include_archived` | Boolean query; false by default                           |
| `include_avatars`  | Boolean query; false by default                           |

```ts
const page = await relay(event, '/internal/v1/channels/123456789012345678/threads?include_archived=true&include_avatars=true&limit=20');
// Empty result: { threads: [], next_before: null }
```

Each thread includes IDs, name, timestamps, archive/lock state, tags, message count, and nullable starter message.
Private threads do not appear. A full page can provide a cursor even when the next page is empty.
Missing or invisible channels return `404`; visible channels without read-history access return `403`.
Malformed query values return `400`.

[Handler](https://github.com/logitland/logitland/blob/main/packages/relay/src/routes/v1-read.ts#L100) · [Thread listing](https://github.com/logitland/logitland/blob/main/packages/relay/src/services/threads.ts#L14) · [Thread schema](https://github.com/logitland/logitland/blob/main/packages/contracts/src/schemas.ts#L1066)
