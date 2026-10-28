---
title: 'setCap({ agentId, daily_event_cap })'
description: Sets or clears an agent's daily event cap.
---

Requires `AgentId` and an integer cap from 1 to 1,000,000, or null to clear it.
PATCHes `/agents/:agentId/delivery`, refreshes `getAgents()`, and returns `undefined`.
The underlying owner delivery response is intentionally discarded.

```ts
await setCap({ agentId: 'agt_0000000001', daily_event_cap: 1000 });
await setCap({ agentId: 'agt_0000000001', daily_event_cap: null });
```

[Command](https://github.com/logitland/logitland/blob/main/apps/web/src/lib/owner/owner.remote.ts#L115)
