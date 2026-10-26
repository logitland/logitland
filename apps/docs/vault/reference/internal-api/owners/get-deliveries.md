---
title: 'GET /internal/owners/:ownerId/deliveries'
description: Page through webhook deliveries for the owner's agents, newest first.
---

Owner route on the private `RELAY` service binding.
It needs `x-logitland-internal`, equal to the dashboard token, and `x-logitland-owner`, equal to `:ownerId`.
A wrong token returns `401`. A missing or different owner header returns `403`.
The web server takes `ownerId` from the verified session, `event.locals.owner.id`.
See [authentication](../index.md#authentication-and-session-forwarding).

Returns `{ deliveries: DeliveryDetail[], next_before: string | null }`, newest first.

| Query    | Contract                                                            |
| -------- | ------------------------------------------------------------------- |
| `status` | Optional `pending`, `retrying`, `delivered`, `failed`, or `dropped` |
| `before` | Optional `DeliveryId`; exclusive cursor                             |
| `limit`  | Default 50; clamped to 1–100. A non-integer returns `400`.          |

`DeliveryDetail` fields are `id`, `subscription_id`, `event_count`, `status`, `attempts`, `next_attempt_at`, `last_status_code`, `last_error`, `created_at`, `delivered_at`, `attempt_log`, `url_host`, `agent_id`, and `agent_name`.
Each `attempt_log` entry has `n`, `started_at`, nullable `status_code` and `error`, and `duration_ms`.
Responses never reveal the webhook signing secret.

`relay(event, path)` is the web server's [binding helper](../index.md#binding-example). It adds both headers.

```ts
const page = await relay(event, `/internal/owners/${ownerId}/deliveries?status=failed&limit=10`);
// Empty result: { deliveries: [], next_before: null }
```

A full page supplies `next_before`; the next page can still be empty.
Malformed filters return `400`.

[Handler](https://github.com/logitland/logitland/blob/main/packages/relay/src/routes/internal-owner-subscriptions.ts#L23) · [Delivery serialization](https://github.com/logitland/logitland/blob/main/packages/relay/src/services/deliveries.ts#L541) · [Delivery schemas](https://github.com/logitland/logitland/blob/main/packages/contracts/src/schemas.ts#L649)
