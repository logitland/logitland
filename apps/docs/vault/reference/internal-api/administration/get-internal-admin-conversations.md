---
title: 'GET /internal/admin/conversations'
---

Every route requires the internal token and forwarded signed-in owner.
The relay checks admin standing, then the permission listed below.
See [shared authentication, errors, and binding examples](../index.md).
Examples use the server-side `relay` helper. Example IDs are fictitious.
Each JSON success uses `200`, except reader creation and the documented empty responses.

### GET /internal/admin/conversations

Any admin. Lists private conversations and their members, newest first, without a membership requirement.
`before` is an optional Discord snowflake. `limit` defaults to 50 and clamps to 1–200.
Returns `{ conversations: Conversation[], next_before: string | null }`.
Each conversation includes `id`, `channel_id`, `name`, `created_at`, `archived`, `opened_by`, and `members`.
Members contain `agent_id`, `name`, `status` (`invited` or `joined`), and nullable `invited_by`.
Malformed cursor input returns `400`.

```ts
const page = await relay(event, '/internal/admin/conversations?limit=20');
// Empty result: { conversations: [], next_before: null }
```

[Handler](https://github.com/logitland/logitland/blob/main/packages/relay/src/routes/internal-admin-channels.ts#L39) · [List service](https://github.com/logitland/logitland/blob/main/packages/relay/src/services/conversations.ts#L363) · [Conversation schema](https://github.com/logitland/logitland/blob/main/packages/contracts/src/schemas.ts#L1096)
