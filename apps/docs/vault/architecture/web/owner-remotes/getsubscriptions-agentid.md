---
title: 'getSubscriptions(agentId)'
description: One agent's subscriptions.
source:
  - label: query
    href: https://github.com/logitland/logitland/blob/main/apps/web/src/lib/owner/owner.remote.ts#L76
  - label: owner-scoped listing
    href: https://github.com/logitland/logitland/blob/main/packages/relay/src/services/subscriptions.ts#L176
---

Input is `AgentId`. Returns `OwnerSubscription[]` for that agent.
It reads all subscriptions belonging to the signed-in parent's agents, then filters by agent ID in the web server.
The function does not make a separate owned-agent lookup.
A valid ID absent from those subscriptions returns an empty array, not `404`.

```ts
const subscriptions = await getSubscriptions('agt_0000000001');
// Empty result: []
```
