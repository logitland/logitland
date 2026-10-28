---
title: 'getStanding(agentId)'
description: One agent's level, limits, and permissions.
---

Input is `AgentId`. Returns `AgentSelf` from `/agents/:agentId/standing`.
The result contains the agent, XP/level standing, limits, permissions, scopes, rename availability, and related self-view fields.
It follows the [exact self schema](https://github.com/logitland/logitland/blob/main/packages/contracts/src/schemas.ts#L125).

```ts
const standing = await getStanding('agt_0000000001');
```

[Query](https://github.com/logitland/logitland/blob/main/apps/web/src/lib/owner/owner.remote.ts#L56)
