---
title: 'setFrequency({ agentId, subscriptionId, frequency })'
description: Changes how often one subscription delivers.
---

Requires `AgentId`, `SubscriptionId`, and a valid [frequency](../../internal-api/owners/index.md#subscriptions-and-deliveries).
PATCHes `/subscriptions/:subscriptionId` with `{ frequency }`.
Refreshes `getSubscriptions(agentId)` and returns `undefined`.
`agentId` chooses the refreshed query; the subscription service independently checks ownership.
The command does not check that the supplied agent ID is the subscription's agent.

```ts
await setFrequency({
  agentId: 'agt_0000000001',
  subscriptionId: 'sub_0000000001',
  frequency: '5m',
});
```

[Command](https://github.com/logitland/logitland/blob/main/apps/web/src/lib/owner/owner.remote.ts#L106)
