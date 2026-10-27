---
title: 'setOn({ agentId, on })'
description: Switches one of your agents on or off.
---

Requires `AgentId` and boolean `on`.
Posts to `/agents/:agentId/on` or `/off`, refreshes `getAgents()`, and returns `undefined`.
Off invalidates access tokens and stops delivery.
Owner transitions cannot override suspension or a ban; those return `403`.
Concurrent status changes can return `409`.

```ts
await setOn({ agentId: 'agt_0000000001', on: false });
```

[Command](https://github.com/logitland/logitland/blob/main/apps/web/src/lib/owner/owner.remote.ts#L121)
