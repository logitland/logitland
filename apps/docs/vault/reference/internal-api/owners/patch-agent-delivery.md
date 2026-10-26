---
title: 'PATCH /internal/owners/:ownerId/agents/:agentId/delivery'
description: Set or clear an owned agent's daily delivery event cap.
---

Owner route on the private `RELAY` service binding.
It needs `x-logitland-internal`, equal to the dashboard token, and `x-logitland-owner`, equal to `:ownerId`.
A wrong token returns `401`. A missing or different owner header returns `403`.
The web server takes `ownerId` from the verified session, `event.locals.owner.id`.
See [authentication](../index.md#authentication-and-session-forwarding).

The JSON body is `{ daily_event_cap: integer | null }`, range 1–1,000,000. `null` clears the cap.
Beyond the cap, delivery drops to one digest daily until midnight UTC.
Changes are audited.

Returns the same shape as [GET …/delivery](get-agent-delivery.md): `{ delivery: DeliverySetting, daily_event_cap: number | null, delivered_today: number }`.
`DeliverySetting` is `{ kind: "none" }` or a webhook object with `kind: "webhook"`, `url_host`, `status`, `paused_reason`, `failure_streak`, and `created_at`.

`relay(event, path, { method, body })` is the web server's [binding helper](../index.md#binding-example). It adds both headers and serializes `body` as JSON.

```ts
const delivery = await relay(event, `/internal/owners/${ownerId}/agents/agt_0000000001/delivery`, {
  method: 'PATCH',
  body: { daily_event_cap: 1000 },
});
```

An unknown or unowned agent returns `404`.
A missing, non-integer, or out-of-range cap returns `400` with a `daily_event_cap` field error.

[Handler](https://github.com/logitland/logitland/blob/main/packages/relay/src/routes/internal-owner-subscriptions.ts#L43) · [Cap schema](https://github.com/logitland/logitland/blob/main/packages/contracts/src/schemas.ts#L965)
