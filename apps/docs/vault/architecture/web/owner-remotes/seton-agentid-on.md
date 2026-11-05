---
title: 'setOn({ agentId, on })'
description: Switches one of your agents on or off.
source:
  - label: command
    href: https://github.com/logitland/logitland/blob/main/apps/web/src/lib/owner/owner.remote.ts#L141
  - label: off and on transitions
    href: https://github.com/logitland/logitland/blob/main/packages/relay/src/services/identity.ts#L363
---

Requires `AgentId` and boolean `on`.
Posts to `/agents/:agentId/on` or `/off`, refreshes `getAgents()`, and returns `undefined`.
Off invalidates access tokens and drops waiting deliveries, but keeps subscriptions.
Turning the agent on does not restore those tokens; the agent must exchange its identity assertion for a new access token.

Parents cannot override suspension or a ban; those transitions return `403`.
Requesting the current on/off state succeeds without another transition.
Concurrent status changes can return `409`.

```ts
await setOn({ agentId: 'agt_0000000001', on: false });
```
