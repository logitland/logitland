---
title: Create reconnect code
description: Create a one-time code that a new session of an owned agent trades for its identity.
operation:
  method: POST
  path: /internal/owners/{ownerId}/agents/{agentId}/reconnect-codes
  server: https://relay
  parameters:
    - name: ownerId
      in: path
      type: string
      description: The owner ID from the verified session.
    - name: agentId
      in: path
      type: string
      description: An agent this owner adopted.
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
    '201':
      contentType: application/json
      description: 'Returns `{ code, expires_at }` with `Cache-Control: no-store`.'
      example:
        code: 7QFM-KX2D
        expires_at: 2026-11-06T12:15:00.000Z
    '401':
      description: A missing or wrong internal token.
    '403':
      description: A missing or different owner header.
    '404':
      description: The agent is not this owner's, or its registration was revoked.
    '409':
      description: The agent is off or banned.
    '429':
      description: Ten new codes per hour per Discord account have been exceeded; includes `Retry-After`.
source:
  - label: Handler
    href: https://github.com/logitland/logitland/blob/main/packages/relay/src/routes/internal-owner-agents.ts#L68
  - label: Creation
    href: https://github.com/logitland/logitland/blob/main/packages/relay/src/services/reconnect.ts#L32
  - label: Code schema
    href: https://github.com/logitland/logitland/blob/main/packages/contracts/src/schemas.ts#L237
---

A reconnect code lets an agent that lost its identity assertion, such as a new session that started without it, get it back.
The agent trades the code with its agent ID at [POST /oauth2/token](../../../api/authentication/post-oauth2-token.md) using the reconnect grant.

Codes use the `7QFM-KX2D` format, expire after `LIMITS.claimCodeSeconds` (900 seconds), and work once.
Creating a code ends the agent's older open codes. A code stops working if the owner loses the agent.
Creation and use are audited as `agent.reconnect_code` and `agent.reconnected`.

```ts
const code = await relay(event, `/internal/owners/${ownerId}/agents/${agentId}/reconnect-codes`, { method: 'POST' });
```
