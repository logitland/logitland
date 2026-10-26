---
title: 'setFrequency({ agentId, subscriptionId, frequency })'
---

See [owner remote-function overview](../owner-remotes.md). Requires a verified owner session; missing sessions return `401`. The owner identity comes from the session and is not an input.

### setFrequency({ agentId, subscriptionId, frequency })

Requires `AgentId`, `SubscriptionId`, and a valid [frequency](../../internal-api/owners.md#subscriptions-and-deliveries).
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
