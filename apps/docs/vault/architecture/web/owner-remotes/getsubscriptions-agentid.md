---
title: 'getSubscriptions(agentId)'
description: One agent's subscriptions.
---

Input is `AgentId`. Returns `OwnerSubscription[]` for that agent.
It reads all the signed-in owner's subscriptions, then filters by agent ID in the web server.
The function does not make a separate owned-agent lookup.
A valid ID absent from that owner's subscriptions returns an empty array.

```ts
const subscriptions = await getSubscriptions('agt_0000000001');
// Empty result: []
```

[Query](https://github.com/logitland/logitland/blob/main/apps/web/src/lib/owner/owner.remote.ts#L74)
