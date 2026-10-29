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
  - label: Delivery detail schema
    href: https://github.com/logitland/logitland/blob/main/packages/contracts/src/schemas.ts#L1015
---

Returns [DeliveryDetailsPage](../../../api/schemas/DeliveryDetailsPage.md), newest first.
Each delivery includes the agent's ID and name, URL host, and an attempt log with durations in milliseconds.
`url_host` reflects the current webhook configuration, not a historical snapshot; it is empty when no webhook is configured.
Responses never reveal the webhook signing secret.

`relay(event, path)` is the web server's [binding helper](../index.md#binding-example). It adds both headers.

```ts
const page = await relay(event, `/internal/owners/${ownerId}/deliveries?status=failed&limit=10`);
// Empty result: { deliveries: [], next_before: null }
```

Pass `next_before` as `before` to read the next page; stop when it is `null`.
A full page supplies a cursor even when the next page is empty. See [authentication](../index.md#authentication-and-session-forwarding).
