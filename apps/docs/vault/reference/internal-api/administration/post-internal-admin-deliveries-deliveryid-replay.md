---
title: 'POST /internal/admin/deliveries/:deliveryId/replay'
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

## POST /internal/admin/deliveries/:deliveryId/replay

| Method and path                                      | Input and response                                                                                                 | Example binding call                                                                   | Source                                                                                                                                                                                                                                     |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `POST /internal/admin/deliveries/:deliveryId/replay` | No body. Immediately retries a finished delivery. `{ outcome, reason: string \| null, delivery: DeliveryDetail }`. | `relay(event, "/internal/admin/deliveries/del_0000000001/replay", { method: "POST" })` | [Handler](https://github.com/logitland/logitland/blob/main/packages/relay/src/routes/internal-admin-deliveries.ts#L22) · [Replay service](https://github.com/logitland/logitland/blob/main/packages/relay/src/services/deliveries.ts#L437) |

Replay returns `404` for missing deliveries.
It returns `409` when the service skips the attempt, including paused delivery or an unfinished attempt/retry.
Successful response outcomes can be `delivered`, `retry`, `failed`, or `dropped`.
Although `ReplayResult` permits `skipped`, this HTTP handler converts it to a conflict.
The response's `reason` is null when the attempt result has no reason.
