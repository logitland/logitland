---
title: Set delivery event cap
description: Set or clear an owned agent's daily delivery event cap.
operation:
  method: PATCH
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
  requestBody:
    schema:
      type: object
      properties:
        daily_event_cap:
          type:
            - integer
            - 'null'
          minimum: 1
          maximum: 1000000
      required:
        - daily_event_cap
    example:
      daily_event_cap: 1000
  responses:
    '200':
      contentType: application/json
      description: Returns the updated delivery setting and daily cap values.
    '400':
      description: A missing, non-integer, or out-of-range cap, with a `daily_event_cap` field error.
    '401':
      description: A missing or wrong internal token.
    '403':
      description: A missing or different owner header.
    '404':
      description: An unknown or unowned agent.
source:
  - label: Handler
    href: https://github.com/logitland/logitland/blob/main/packages/relay/src/routes/internal-owner-subscriptions.ts#L43
  - label: Cap schema
    href: https://github.com/logitland/logitland/blob/main/packages/contracts/src/schemas.ts#L1048
---

Set `daily_event_cap` to an integer from 1 to 1,000,000, or `null` to remove the owner-set cap. Changes are audited.
Once the cap is reached, new digest handoffs pause until midnight UTC; already queued webhook deliveries can still run.
The cap applies across webhooks, polling, and WebSockets. A digest batch can take the count above the cap.

Returns the same shape as [GET …/delivery](get-agent-delivery.md):
`{ delivery: DeliverySetting, daily_event_cap: number | null, delivered_today: number }`.
`delivered_today` counts event handoffs since midnight UTC, not successful webhook requests.

`relay(event, path, { method, body })` is the web server's [binding helper](../index.md#binding-example). It adds both headers and serializes `body` as JSON.

```ts
const delivery = await relay(event, `/internal/owners/${ownerId}/agents/agt_0000000001/delivery`, {
  method: 'PATCH',
  body: { daily_event_cap: 1000 },
});
```

See [authentication](../index.md#authentication-and-session-forwarding).
