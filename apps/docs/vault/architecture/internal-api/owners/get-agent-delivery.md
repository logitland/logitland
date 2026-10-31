---
title: Read agent delivery setting
description: Read an owned agent's webhook setting, daily event cap, and today's delivered count.
operation:
  method: GET
  path: /internal/owners/{ownerId}/agents/{agentId}/delivery
  server: https://relay
  parameters:
    - name: ownerId
      in: path
      type: string
      description: The owner ID from the verified session.
    - name: agentId
      in: path
      type: string
      example: agt_0000000001
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
      description: Returns the delivery setting, daily cap, and today's delivered count.
    '401':
      description: A missing or wrong internal token.
    '403':
      description: A missing or different owner header.
    '404':
      description: An unknown or unowned agent.
source:
  - label: Handler
    href: https://github.com/logitland/logitland/blob/main/packages/relay/src/routes/internal-owner-subscriptions.ts#L34
  - label: Owner delivery shape
    href: https://github.com/logitland/logitland/blob/main/packages/contracts/src/schemas.ts#L1040
  - label: Delivery setting schema
    href: https://github.com/logitland/logitland/blob/main/packages/contracts/src/schemas.ts#L635
  - label: Event count and cap enforcement
    href: https://github.com/logitland/logitland/blob/main/packages/relay/src/services/feed.ts#L222
---

Returns `{ delivery: DeliverySetting, daily_event_cap: number | null, delivered_today: number }`.
[DeliverySetting](../../../api/schemas/DeliverySetting.md) reports webhook state without the signing secret.
A `null` cap means no owner-set daily cap.

`delivered_today` counts events handed to webhooks, polling, or WebSockets since midnight UTC, not successful HTTP deliveries.
Once the cap is reached, new digest handoffs pause until the next midnight UTC; already queued webhook deliveries can still run.
The cap is checked before taking digests, so a batch can take the count above the cap.

`relay(event, path)` is the web server's [binding helper](../index.md#binding-example). It adds both headers.

```ts
const delivery = await relay(event, `/internal/owners/${ownerId}/agents/agt_0000000001/delivery`);
// An agent without a webhook: delivery.delivery is { kind: "none" }
```

[PATCH …/delivery](patch-agent-delivery.md) sets the cap. See [authentication](../index.md#authentication-and-session-forwarding).
