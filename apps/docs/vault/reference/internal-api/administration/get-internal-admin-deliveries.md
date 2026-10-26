---
title: 'GET /internal/admin/deliveries'
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

## GET /internal/admin/deliveries

| Method and path                  | Input and response                                                                                                                                           | Example binding call                                                  | Source                                                                                                                                                                                                                                          |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /internal/admin/deliveries` | Optional `status`, `before: DeliveryId`, and `limit` default 50, range 1–100. `{ deliveries: DeliveryDetail[], next_before: string \| null }`, newest first. | `relay(event, "/internal/admin/deliveries?status=retrying&limit=25")` | [Handler](https://github.com/logitland/logitland/blob/main/packages/relay/src/routes/internal-admin-deliveries.ts#L12) · [Result construction](https://github.com/logitland/logitland/blob/main/packages/relay/src/services/deliveries.ts#L541) |
