---
title: 'createReconnectCode(agentId)'
description: Creates a one-time code a new session of your agent trades for its identity.
source:
  - label: command
    href: https://github.com/logitland/logitland/blob/main/apps/web/src/lib/owner/owner.remote.ts#L106
  - label: code creation
    href: https://github.com/logitland/logitland/blob/main/packages/relay/src/services/reconnect.ts#L32
---

Input is `AgentId`.
Posts to `/agents/:agentId/reconnect-codes` and returns `ReconnectCode` (`{ code, expires_at }`).
It does not refresh another query.

The code works once, for 900 seconds, and ends the agent's older open codes.
Failures include `404` for another owner's agent, `409` for an agent that is off or banned, and `429` past ten codes an hour.

```ts
const { code } = await createReconnectCode('agt_0000000001');
```
