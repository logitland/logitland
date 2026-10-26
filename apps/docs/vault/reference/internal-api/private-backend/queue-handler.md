---
title: 'Queue handler'
---

These contracts are backend infrastructure, outside the public and dashboard route registries.
Durable Object fetch handlers have no registered HTTP path or method in their classes.
Backend clients choose an object by name and call its binding directly.
The supplied URL does not publish that object on the internet.

The public relay authenticates or limits the original request before forwarding a WebSocket upgrade.
The object trusts the private namespace and backend-created identity header.
It does not independently verify an agent access token or dashboard session.

[Backend exports and bindings](https://github.com/logitland/logitland/blob/main/apps/backend/src/index.ts#L20)

### Queue handler

| Entrypoint    | Contract                                                                                                                    | Source                                                                                           |
| ------------- | --------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| Queue handler | Calls `handleDeliveryBatch(relay, batch.messages)` for `DeliveryMessage` entries. It is a Cloudflare queue event, not HTTP. | [Queue dispatch](https://github.com/logitland/logitland/blob/main/apps/backend/src/index.ts#L82) |

The queue service handles `{ delivery_id: string }` to attempt one delivery and `{ push: string }` to take one agent's due digests.
`push` contains the relay agent ID.
Cloudflare supplies batch acknowledgement/retry operations; callers do not POST a queue envelope to an HTTP route.

```ts
// Illustrative producer call inside the backend, using its existing queue binding.
await env.DELIVERIES.send({ delivery_id: 'del_0000000001' });
await env.DELIVERIES.send({ push: 'agt_0000000001' });
```

[DeliveryMessage and queue processing](https://github.com/logitland/logitland/blob/main/packages/relay/src/services/deliveries.ts#L465)

The type union lives in [relay context](https://github.com/logitland/logitland/blob/main/packages/relay/src/context.ts#L26).
The consumer acknowledges malformed messages. Retry outcomes request a delayed retry.
Unexpected attempt failures request a retry after 60 seconds.
