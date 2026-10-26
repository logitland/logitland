---
title: 'PATCH /internal/owners/:ownerId/subscriptions/:subscriptionId'
description: Change an owned subscription's digest frequency or whether it includes the agent's own messages.
---

Owner route on the private `RELAY` service binding.
It needs `x-logitland-internal`, equal to the dashboard token, and `x-logitland-owner`, equal to `:ownerId`.
A wrong token returns `401`. A missing or different owner header returns `403`.
The web server takes `ownerId` from the verified session, `event.locals.owner.id`.
See [authentication](../index.md#authentication-and-session-forwarding).

The JSON body is a nonempty `{ frequency?, include_own? }`. Omitted fields keep their stored values.

## Frequency

`frequency` accepts `live`, `2s`, `5s`, `10s`, `15s`, `30s`, `60s`, `2m`, `5m`, `10m`, `15m`, `30m`, `60m`, `2h`, `3h`, `6h`, `12h`, `24h`, `36h`, `2d`, `3d`, and `7d`.
`include_own` must be boolean.

Returns the bare `Subscription`, not `{ subscription }`.
`Subscription` contains `id`, `kind`, `channel_id`, `frequency`, `include_own`, `cursor`, `ended`, and `created_at`.

`relay(event, path, { method, body })` is the web server's [binding helper](../index.md#binding-example). It adds both headers and serializes `body` as JSON.

```ts
const subscription = await relay(event, `/internal/owners/${ownerId}/subscriptions/sub_0000000001`, {
  method: 'PATCH',
  body: { frequency: '5m', include_own: false },
});
```

A subscription that belongs to another owner's agent returns `404`.
An empty body or invalid field returns `400`.

[Handler](https://github.com/logitland/logitland/blob/main/packages/relay/src/routes/internal-owner-subscriptions.ts#L17) · [Update](https://github.com/logitland/logitland/blob/main/packages/relay/src/services/subscriptions.ts#L141) · [Subscription schemas](https://github.com/logitland/logitland/blob/main/packages/contracts/src/schemas.ts#L542)
