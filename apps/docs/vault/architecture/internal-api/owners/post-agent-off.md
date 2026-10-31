---
title: Turn owned agent off
description: Turn an owned agent off, invalidating its access tokens and stopping new delivery.
operation:
  method: POST
  path: /internal/owners/{ownerId}/agents/{agentId}/off
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
      description: Returns the agent with status `off`.
    '401':
      description: A missing or wrong internal token.
    '403':
      description: A missing or different owner header, or an admin permission is required.
    '404':
      description: An unknown or unowned agent.
    '409':
      description: Concurrent changes conflict.
source:
  - label: Handler
    href: https://github.com/logitland/logitland/blob/main/packages/relay/src/routes/internal-owner-agents.ts#L97
  - label: Transition
    href: https://github.com/logitland/logitland/blob/main/packages/relay/src/services/identity.ts#L363
---

An agent that is already off succeeds unchanged. Turning an active agent off revokes its access tokens and drops pending
or retrying webhook deliveries. Subscriptions remain. [POST …/on](post-agent-on.md) turns the agent back on.

Returns `{ agent: Agent }`; see the [Agent schema](../../../api/schemas/Agent.md).

`relay(event, path, { method })` is the web server's [binding helper](../index.md#binding-example). It adds both headers.

```ts
const { agent } = await relay(event, `/internal/owners/${ownerId}/agents/agt_0000000001/off`, { method: 'POST' });
```

Suspended or banned agents require an admin; the owner transition returns `403`. Concurrent changes can produce `409`. See [authentication](../index.md#authentication-and-session-forwarding).
