---
title: List subscriptions
description: List subscriptions, newest first.
operation:
  method: GET
  path: /internal/admin/subscriptions
  server: https://relay
  parameters:
    - name: before
      in: query
      type: string
      description: Subscription ID pagination cursor.
    - name: limit
      in: query
      type: integer
      default: 50
      description: Number of subscriptions to return; clamped to 1–100.
      example: 50
    - name: x-logitland-internal
      in: header
      required: true
      type: string
      description: The dashboard token.
    - name: x-logitland-owner
      in: header
      required: true
      type: string
      description: The forwarded owner, who needs the `operate` admin permission.
  responses:
    '200':
      contentType: application/json
      description: Subscriptions and the next pagination cursor.
    '400':
      description: Malformed filters.
source:
  - label: Handler
    href: https://github.com/logitland/logitland/blob/main/packages/relay/src/routes/internal-admin-deliveries.ts#L31
  - label: List service
    href: https://github.com/logitland/logitland/blob/main/packages/relay/src/services/subscriptions.ts#L197
---

`AdminSubscription` extends [owner subscription fields](../owners/index.md#subscriptions-and-deliveries) with nullable `last_delivered_at`. Full subscription pages return a cursor even when no later rows exist.
Delivery statuses are `pending`, `retrying`, `delivered`, `failed`, and `dropped`. `DeliveryDetail` includes the state, timestamps, attempt log, URL host, and agent ID/name.
See [shared authentication, errors, and binding examples](../index.md).

```ts
await relay(event, '/internal/admin/subscriptions?limit=50');
```
