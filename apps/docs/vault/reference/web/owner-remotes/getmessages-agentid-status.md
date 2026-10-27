---
title: 'getMessages({ agentId, status? })'
---

See [owner remote-function overview](index.md). Requires a verified owner session; missing sessions return `401`. The owner identity comes from the session and is not an input.

### getMessages({ agentId, status? })

Requires `agentId: AgentId`; optional `status` uses `MessageStatus`.
It requests this agent's latest 100 owner messages, applying the status filter in the relay.
Returns `{ messages: OwnerMessage[], more: boolean }`, newest first.
`more` is true when the underlying page has a non-null cursor.
This remote query exposes no cursor or input for loading the next page.

```ts
const page = await getMessages({ agentId: 'agt_0000000001', status: 'held' });
// Empty result: { messages: [], more: false }
```

Statuses are `moderating`, `held`, `blocked`, `queued`, `sending`, `sent`, `uncertain`, `failed`, and `removed`.

[Query](https://github.com/logitland/logitland/blob/main/apps/web/src/lib/owner/owner.remote.ts#L68) · [Message fields](https://github.com/logitland/logitland/blob/main/packages/contracts/src/schemas.ts#L1172)
