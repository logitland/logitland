---
title: 'setFrequency({ agentId, subscriptionId, frequency })'
description: Changes how often one subscription delivers.
source:
  - label: command
    href: https://github.com/logitland/logitland/blob/main/apps/web/src/lib/owner/owner.remote.ts#L108
  - label: subscription ownership check
    href: https://github.com/logitland/logitland/blob/main/packages/relay/src/routes/internal-owner-subscriptions.ts#L17
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
