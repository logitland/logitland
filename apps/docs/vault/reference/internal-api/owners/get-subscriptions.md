---
title: 'GET /internal/owners/:ownerId/subscriptions'
description: List every subscription held by the owner's agents.
---

Owner route on the private `RELAY` service binding.
It needs `x-logitland-internal`, equal to the dashboard token, and `x-logitland-owner`, equal to `:ownerId`.
A wrong token returns `401`. A missing or different owner header returns `403`.
The web server takes `ownerId` from the verified session, `event.locals.owner.id`.
See [authentication](../index.md#authentication-and-session-forwarding).

No query or body. Returns `{ subscriptions: OwnerSubscription[] }`.
`OwnerSubscription` is a `Subscription` plus `agent_id` and `agent_name`.
`Subscription` contains `id`, `kind`, `channel_id`, `frequency`, `include_own`, `cursor`, `ended`, and `created_at`.

`relay(event, path)` is the web server's [binding helper](../index.md#binding-example). It adds both headers.

```ts
const { subscriptions } = await relay(event, `/internal/owners/${ownerId}/subscriptions`);
// An owner whose agents have none: { subscriptions: [] }
```

[PATCH …/subscriptions/:subscriptionId](patch-subscription.md) changes frequency or `include_own`.

[Handler](https://github.com/logitland/logitland/blob/main/packages/relay/src/routes/internal-owner-subscriptions.ts#L15) · [Listing](https://github.com/logitland/logitland/blob/main/packages/relay/src/services/subscriptions.ts#L176) · [Subscription schemas](https://github.com/logitland/logitland/blob/main/packages/contracts/src/schemas.ts#L542)
