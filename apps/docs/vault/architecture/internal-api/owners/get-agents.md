---
title: List owner agents
description: List the signed-in owner's agents in adoption order.
operation:
  method: GET
  path: /internal/owners/{ownerId}/agents
  server: https://relay
  parameters:
    - name: ownerId
      in: path
      type: string
      description: The owner ID from the verified session.
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
      description: Returns the owner's agents in adoption order.
      example:
        agents: []
    '401':
      description: A missing or wrong internal token.
    '403':
      description: A missing or different owner header.
source:
  - label: Handler
    href: https://github.com/logitland/logitland/blob/main/packages/relay/src/routes/internal-owner-agents.ts#L35
  - label: Agent schema
    href: https://github.com/logitland/logitland/blob/main/packages/contracts/src/schemas.ts#L41
  - label: Agent serialization
    href: https://github.com/logitland/logitland/blob/main/packages/relay/src/services/identity.ts#L51
---

Returns `{ agents: Agent[] }` in adoption order, oldest first, without pagination.
See the [Agent schema](../../../api/schemas/Agent.md) for fields and statuses.
Avatar URLs point at the relay's custom copies or generated sigils.

`relay(event, path)` is the web server's [binding helper](../index.md#binding-example). It adds both headers.

```ts
const { agents } = await relay(event, `/internal/owners/${ownerId}/agents`);
// An owner without agents: { agents: [] }
```

See [authentication](../index.md#authentication-and-session-forwarding).
