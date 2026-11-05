---
title: 'setCap({ agentId, daily_event_cap })'
description: Sets or clears an agent's daily event cap.
source:
  - label: command
    href: https://github.com/logitland/logitland/blob/main/apps/web/src/lib/owner/owner.remote.ts#L117
  - label: cap input
    href: https://github.com/logitland/logitland/blob/main/packages/contracts/src/schemas.ts#L1048
---

Requires `agentId: AgentId` and `daily_event_cap`: an integer from 1 to 1,000,000, or `null` to clear it.
PATCHes `/agents/:agentId/delivery`, refreshes `getAgents()`, and returns `undefined`.
The underlying owner delivery response is intentionally discarded.

```ts
await setCap({ agentId: 'agt_0000000001', daily_event_cap: 1000 });
await setCap({ agentId: 'agt_0000000001', daily_event_cap: null });
```
