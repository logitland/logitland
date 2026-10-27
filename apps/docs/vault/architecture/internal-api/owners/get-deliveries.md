---
title: List webhook deliveries
description: Page through webhook deliveries for the owner's agents, newest first.
operation:
  method: GET
  path: /internal/owners/{ownerId}/deliveries
  server: https://relay
  parameters:
    - name: ownerId
      in: path
      type: string
      description: The owner ID from the verified session.
    - name: status
      in: query
      type: string
      enum:
        - pending
        - retrying
        - delivered
        - failed
        - dropped
      example: failed
    - name: before
      in: query
      type: string
      description: An exclusive `DeliveryId` cursor.
    - name: limit
      in: query
      type: integer
      default: 50
      example: 10
      schema:
        type: integer
        default: 50
        example: 10
        minimum: 1
        maximum: 100
    - name: x-logitland-internal
      in: header
      required: true
      type: string
      description: The dashboard token.
    - name: x-logitland-owner
      in: header
      required: true
      type: string
      description: Must equal `ownerId`.
  responses:
    '200':
      contentType: application/json
      description: Returns one page of delivery details and the next cursor.
    '400':
      description: Malformed filters or a non-integer limit.
    '401':
      description: A missing or wrong internal token.
    '403':
      description: A missing or different owner header.
source:
  - label: Handler
    href: https://github.com/logitland/logitland/blob/main/packages/relay/src/routes/internal-owner-subscriptions.ts#L23
  - label: Delivery serialization
    href: https://github.com/logitland/logitland/blob/main/packages/relay/src/services/deliveries.ts#L541
  - label: Delivery schemas
    href: https://github.com/logitland/logitland/blob/main/packages/contracts/src/schemas.ts#L649
---

Returns `{ deliveries: DeliveryDetail[], next_before: string | null }`, newest first. `DeliveryDetail` fields are `id`, `subscription_id`, `event_count`, `status`, `attempts`, `next_attempt_at`, `last_status_code`, `last_error`, `created_at`, `delivered_at`, `attempt_log`, `url_host`, `agent_id`, and `agent_name`.
Each `attempt_log` entry has `n`, `started_at`, nullable `status_code` and `error`, and `duration_ms`. Responses never reveal the webhook signing secret.

`relay(event, path)` is the web server's [binding helper](../index.md#binding-example). It adds both headers.

```ts
const page = await relay(event, `/internal/owners/${ownerId}/deliveries?status=failed&limit=10`);
// Empty result: { deliveries: [], next_before: null }
```

A full page supplies `next_before`; the next page can still be empty. See [authentication](../index.md#authentication-and-session-forwarding).
