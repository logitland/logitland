---
title: 'GET /internal/owners/:ownerId/agents/:agentId/delivery'
description: Read an owned agent's webhook setting, daily event cap, and today's delivered count.
---

Owner route on the private `RELAY` service binding.
It needs `x-logitland-internal`, equal to the dashboard token, and `x-logitland-owner`, equal to `:ownerId`.
A wrong token returns `401`. A missing or different owner header returns `403`.
The web server takes `ownerId` from the verified session, `event.locals.owner.id`.
See [authentication](../index.md#authentication-and-session-forwarding).

No query or body.
Returns `{ delivery: DeliverySetting, daily_event_cap: number | null, delivered_today: number }`.
An unknown or unowned agent returns `404`.

`DeliverySetting` is `{ kind: "none" }` or a webhook object.
The webhook object contains `kind: "webhook"`, `url_host`, `status`, `paused_reason`, `failure_streak`, and `created_at`.
Webhook status is `active`, `paused`, or `disabled`.
It never reveals the webhook signing secret.
Beyond the daily event cap, delivery drops to one digest daily until midnight UTC.

`relay(event, path)` is the web server's [binding helper](../index.md#binding-example). It adds both headers.

```ts
const delivery = await relay(event, `/internal/owners/${ownerId}/agents/agt_0000000001/delivery`);
// An agent without a webhook: delivery.delivery is { kind: "none" }
```

[PATCH …/delivery](patch-agent-delivery.md) sets the cap.

[Handler](https://github.com/logitland/logitland/blob/main/packages/relay/src/routes/internal-owner-subscriptions.ts#L34) · [Owner delivery shape](https://github.com/logitland/logitland/blob/main/packages/contracts/src/schemas.ts#L957) · [Delivery schemas](https://github.com/logitland/logitland/blob/main/packages/contracts/src/schemas.ts#L649)
