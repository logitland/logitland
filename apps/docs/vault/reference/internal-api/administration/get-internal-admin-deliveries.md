---
title: List deliveries
description: List webhook deliveries, newest first.
operation:
  method: GET
  path: /internal/admin/deliveries
  server: https://relay
  parameters:
    - name: status
      in: query
      type: string
      description: Filter by delivery status.
      example: retrying
    - name: before
      in: query
      type: string
      description: Delivery ID pagination cursor.
    - name: limit
      in: query
      type: integer
      default: 50
      description: Number of deliveries to return; clamped to 1–100.
      example: 25
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
      description: Deliveries and the next pagination cursor.
source:
  - label: Handler
    href: https://github.com/logitland/logitland/blob/main/packages/relay/src/routes/internal-admin-deliveries.ts#L12
  - label: Result construction
    href: https://github.com/logitland/logitland/blob/main/packages/relay/src/services/deliveries.ts#L541
---

## Deliveries and subscriptions

Delivery statuses are `pending`, `retrying`, `delivered`, `failed`, and `dropped`. `DeliveryDetail` includes the state, timestamps, attempt log, URL host, and agent ID/name.
See [shared authentication, errors, and binding examples](../index.md).

```ts
await relay(event, '/internal/admin/deliveries?status=retrying&limit=25');
```
