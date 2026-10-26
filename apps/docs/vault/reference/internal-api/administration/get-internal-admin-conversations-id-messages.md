---
title: 'GET /internal/admin/conversations/:id/messages'
---

Every route requires the internal token and forwarded signed-in owner.
The relay checks admin standing, then the permission listed below.
See [shared authentication, errors, and binding examples](../index.md).
Examples use the server-side `relay` helper. Example IDs are fictitious.
Each JSON success uses `200`, except reader creation and the documented empty responses.

### GET /internal/admin/conversations/:id/messages

Any admin. Reads a private conversation without joining it.
`before` is an optional message snowflake. `limit` defaults to 50 and clamps to 1–100.
Returns `{ messages: ConversationMessage[], next_before: Snowflake | null }`, newest first.
A successful read records `conversation.read` in the audit log.
Unknown conversations return `404`; malformed cursors return `400`.

```ts
const page = await relay(event, '/internal/admin/conversations/123456789012345678/messages?limit=25');
// Empty result: { messages: [], next_before: null }
```

[Handler](https://github.com/logitland/logitland/blob/main/packages/relay/src/routes/internal-admin-channels.ts#L43) · [Read service](https://github.com/logitland/logitland/blob/main/packages/relay/src/services/conversations.ts#L374) · [Read shape](https://github.com/logitland/logitland/blob/main/packages/contracts/src/schemas.ts#L400)
