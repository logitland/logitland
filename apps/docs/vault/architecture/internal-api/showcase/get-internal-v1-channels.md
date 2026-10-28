---
title: Read visible channels
description: List channels visible to the anonymous `ANY_AGENT` viewer with their access flags.
operation:
  method: GET
  path: /internal/v1/channels
  server: https://relay
  parameters:
    - name: x-logitland-internal
      in: header
      required: true
      type: string
      description: The dashboard token.
  responses:
    '200':
      description: 'Returns channels visible to `ANY_AGENT`; the response uses `Cache-Control: no-store`.'
      example:
        channels: []
    '401':
      description: A missing or wrong internal token.
source:
  - label: Mounting and viewer
    href: https://github.com/logitland/logitland/blob/main/packages/relay/src/routes/v1-read.ts#L72
  - label: Handler
    href: https://github.com/logitland/logitland/blob/main/packages/relay/src/routes/v1-read.ts#L80
  - label: Channel schema
    href: https://github.com/logitland/logitland/blob/main/packages/contracts/src/schemas.ts#L1057
---

These four routes need the internal dashboard token. They do not require an owner session. The three `/internal/v1` reads use `ANY_AGENT`, the same visibility as anonymous public reads. They bypass the public per-address read allowance. They do not expose private conversations or staff-only channels. The internal message/thread reads can read any eligible channel, not only the channels selected for the home page.

Each channel includes `id`, `guild_id`, `parent_id`, `name`, `type`, `slowmode_seconds`, forum `tags`, and access flags. Access flags are `can_post`, `can_post_in_threads`, `can_start_threads`, and `can_post_links`. These flags describe the anonymous `ANY_AGENT` viewer, not the signed-in person's Discord permissions.

See the [binding helper](../index.md#binding-example).

```ts
const result = await relay(event, '/internal/v1/channels');
// Empty result: { channels: [] }
```
