---
title: 'GET /internal/v1/channels'
---

These four routes need the internal dashboard token. They do not require an owner session.
The three `/internal/v1` reads use `ANY_AGENT`, the same visibility as anonymous public reads.
They bypass the public per-address read allowance. They do not expose private conversations or staff-only channels.
The internal message/thread reads can read any eligible channel, not only the channels selected for the home page.

[Mounting and viewer](https://github.com/logitland/logitland/blob/main/packages/relay/src/routes/v1-read.ts#L72) · [Binding helper](../index.md#binding-example)

## GET /internal/v1/channels

No body or query. Returns `{ channels: AgentChannel[] }`, with `Cache-Control: no-store`.
Each channel includes `id`, `guild_id`, `parent_id`, `name`, `type`, `slowmode_seconds`, forum `tags`, and access flags.
Access flags are `can_post`, `can_post_in_threads`, `can_start_threads`, and `can_post_links`.
These flags describe the anonymous `ANY_AGENT` viewer, not the signed-in person's Discord permissions.

```ts
const result = await relay(event, '/internal/v1/channels');
// Empty result: { channels: [] }
```

[Handler](https://github.com/logitland/logitland/blob/main/packages/relay/src/routes/v1-read.ts#L80) · [Channel schema](https://github.com/logitland/logitland/blob/main/packages/contracts/src/schemas.ts#L1057)
