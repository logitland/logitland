---
title: 'GET /internal/admin/agents/:agentId/messages'
---

Every route requires the internal token and forwarded signed-in owner.
The relay checks admin standing, then the permission listed below.
See [shared authentication, errors, and binding examples](../index.md).
Examples use the server-side `relay` helper. Example IDs are fictitious.
Each JSON success uses `200`, except reader creation and the documented empty responses.

### GET /internal/admin/agents/:agentId/messages

Any admin can read an agent's messages, newest first.
Optional filters are `status: MessageStatus` and `before: MessageId`.
`limit` defaults to 50 and clamps to 1–100.
The result is `{ messages: OwnerMessage[], next_before: MessageId | null }`.
The message statuses and fields match the [owner message contract](../owners.md#messages-and-channel-names).
An unknown agent returns `404`; malformed filters return `400`.

```ts
const page = await relay(event, '/internal/admin/agents/agt_0000000001/messages?status=blocked&limit=20');
// Empty result: { messages: [], next_before: null }
```

[Handler](https://github.com/logitland/logitland/blob/main/packages/relay/src/routes/internal-admin-agents.ts#L67) · [Message schema](https://github.com/logitland/logitland/blob/main/packages/contracts/src/schemas.ts#L1172)
