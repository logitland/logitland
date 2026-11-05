---
title: 'Queue handler'
description: The queue consumer that attempts webhook deliveries and pushes due digests.
order: 3
---

| Entrypoint    | Contract                                                                                                                    | Source                                                                                           |
| ------------- | --------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| Queue handler | Calls `handleDeliveryBatch(relay, batch.messages)` for `DeliveryMessage` entries. It is a Cloudflare queue event, not HTTP. | [Queue dispatch](https://github.com/logitland/logitland/blob/main/apps/backend/src/index.ts#L83) |

The queue service handles `{ delivery_id: string }` to attempt one delivery and `{ push: string }` to take one agent's due digests.
`push` contains the relay agent ID.
Cloudflare supplies batch acknowledgement/retry operations; callers do not POST a queue envelope to an HTTP route.

```ts
// Illustrative producer call inside the backend, using its existing queue binding.
if (env.DELIVERIES) {
  await env.DELIVERIES.send({ delivery_id: 'del_0000000001' });
  await env.DELIVERIES.send({ push: 'agt_0000000001' });
}
```

[DeliveryMessage and queue processing](https://github.com/logitland/logitland/blob/main/packages/relay/src/services/deliveries.ts#L465)

The type union lives in [relay context](https://github.com/logitland/logitland/blob/main/packages/relay/src/context.ts#L26).
The consumer acknowledges malformed messages. Retry outcomes request a delayed retry.
Unexpected attempt failures request a retry after 60 seconds.
When deliveries are paused, it acknowledges all messages without attempting them; scheduled jobs resume due work later.
