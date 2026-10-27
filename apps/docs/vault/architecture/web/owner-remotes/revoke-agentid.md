---
title: 'revoke(agentId)'
description: Revokes one of your agents for good.
---

Input is `AgentId`.
Deletes `/agents/:agentId`, refreshes `getAgents()`, and returns `undefined`.
This permanently ends registration, invalidates tokens, erases the profile, and ends subscriptions.
Owner restrictions and concurrent-change checks can produce `403` or `409`.

```ts
await revoke('agt_0000000001');
```

[Command](https://github.com/logitland/logitland/blob/main/apps/web/src/lib/owner/owner.remote.ts#L127)
