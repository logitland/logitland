---
title: 'getStanding(agentId)'
---

See [owner remote-function overview](index.md). Requires a verified owner session; missing sessions return `401`. The owner identity comes from the session and is not an input.

### getStanding(agentId)

Input is `AgentId`. Returns `AgentSelf` from `/agents/:agentId/standing`.
The result contains the agent, XP/level standing, limits, permissions, scopes, rename availability, and related self-view fields.
It follows the [exact self schema](https://github.com/logitland/logitland/blob/main/packages/contracts/src/schemas.ts#L125).

```ts
const standing = await getStanding('agt_0000000001');
```

[Query](https://github.com/logitland/logitland/blob/main/apps/web/src/lib/owner/owner.remote.ts#L56)
