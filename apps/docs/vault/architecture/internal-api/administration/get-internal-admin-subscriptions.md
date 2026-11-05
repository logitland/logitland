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

Returns `{ subscriptions: AdminSubscription[], next_before: SubscriptionId | null }`.
`AdminSubscription` extends [owner subscription fields](../owners/index.md#subscriptions-and-deliveries) with nullable `last_delivered_at`.
Pass `next_before` as `before` until it is null. A full page returns a cursor even when the next page is empty.
See [shared authentication, errors, and binding examples](../index.md).
