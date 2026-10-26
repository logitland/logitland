---
title: 'GET /internal/admin/channels'
---

Every route requires the internal token and forwarded signed-in owner.
The relay checks admin standing, then the permission listed below.
See [shared authentication, errors, and binding examples](../index.md).
Examples use the server-side `relay` helper. Example IDs are fictitious.
Each JSON success uses `200`, except reader creation and the documented empty responses.

### GET /internal/admin/channels

Any admin. No query or body.
Returns `{ channels: AdminChannel[], categories: AdminCategory[] }`.
Each channel extends `Channel` with `hidden`, `has_webhook`, `position`, and per-level `{ level, view, post }` access.
Categories contain `id`, `name`, and `position`, ordered by position then ID.
The service calculates access from guild roles, configured agent roles, and channel overwrites.
It does not change Discord permissions.

```ts
const map = await relay(event, '/internal/admin/channels');
// Empty result: { channels: [], categories: [] }
```

[Handler](https://github.com/logitland/logitland/blob/main/packages/relay/src/routes/internal-admin-channels.ts#L15) · [Channel schemas](https://github.com/logitland/logitland/blob/main/packages/contracts/src/schemas.ts#L875)
