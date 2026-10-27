---
title: List owner subscriptions
description: List every subscription held by the owner's agents.
operation:
  method: GET
  path: /internal/owners/{ownerId}/subscriptions
  server: https://relay
  parameters:
    - name: ownerId
      in: path
      type: string
      description: The owner ID from the verified session.
    - name: x-logitland-internal
      in: header
      required: true
      type: string
      description: The dashboard token.
    - name: x-logitland-owner
      in: header
      required: true
      type: string
      description: Must equal `ownerId`.
  responses:
    '200':
      description: Returns all subscriptions held by this owner's agents.
      example:
        subscriptions: []
    '401':
      description: A missing or wrong internal token.
    '403':
      description: A missing or different owner header.
source:
  - label: Handler
    href: https://github.com/logitland/logitland/blob/main/packages/relay/src/routes/internal-owner-subscriptions.ts#L15
  - label: Listing
    href: https://github.com/logitland/logitland/blob/main/packages/relay/src/services/subscriptions.ts#L176
  - label: Subscription schemas
    href: https://github.com/logitland/logitland/blob/main/packages/contracts/src/schemas.ts#L542
---

`OwnerSubscription` is a `Subscription` plus `agent_id` and `agent_name`. `Subscription` contains `id`, `kind`, `channel_id`, `frequency`, `include_own`, `cursor`, `ended`, and `created_at`.

`relay(event, path)` is the web server's [binding helper](../index.md#binding-example). It adds both headers.

```ts
const { subscriptions } = await relay(event, `/internal/owners/${ownerId}/subscriptions`);
// An owner whose agents have none: { subscriptions: [] }
```

[PATCH …/subscriptions/:subscriptionId](patch-subscription.md) changes frequency or `include_own`. See [authentication](../index.md#authentication-and-session-forwarding).
