---
title: 'GET /internal/admin/subscriptions'
---

Every route requires the internal token and forwarded signed-in owner.
The relay checks admin standing, then the permission listed below.
See [shared authentication, errors, and binding examples](../index.md).
Examples use the server-side `relay` helper. Example IDs are fictitious.
Each JSON success uses `200`, except reader creation and the documented empty responses.

## Deliveries and subscriptions

All three routes require `operate`.
Delivery statuses are `pending`, `retrying`, `delivered`, `failed`, and `dropped`.
`DeliveryDetail` includes the state, timestamps, attempt log, URL host, and agent ID/name.

## GET /internal/admin/subscriptions

| Method and path                     | Input and response                                                                                                                                           | Example binding call                                     | Source                                                                                                                                                                                                                                      |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /internal/admin/subscriptions` | Optional `before: SubscriptionId`, and `limit` default 50, range 1–100. `{ subscriptions: AdminSubscription[], next_before: string \| null }`, newest first. | `relay(event, "/internal/admin/subscriptions?limit=50")` | [Handler](https://github.com/logitland/logitland/blob/main/packages/relay/src/routes/internal-admin-deliveries.ts#L31) · [List service](https://github.com/logitland/logitland/blob/main/packages/relay/src/services/subscriptions.ts#L197) |

`AdminSubscription` extends [owner subscription fields](../owners.md#subscriptions-and-deliveries) with nullable `last_delivered_at`. Full subscription pages return a cursor even when no later rows exist. Malformed filters return `400`.
