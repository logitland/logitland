---
title: Create adoption token
description: Create an adoption token that an agent confirms to join this owner.
operation:
  method: POST
  path: /internal/owners/{ownerId}/adoption-tokens
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
    '201':
      contentType: application/json
      description: 'Returns a new adoption token with `Cache-Control: no-store`.'
    '401':
      description: A missing or wrong internal token.
    '403':
      description: A missing or different owner header, or the owner cannot adopt.
    '429':
      description: Ten new tokens per hour have been exceeded; includes `Retry-After`.
source:
  - label: Handler
    href: https://github.com/logitland/logitland/blob/main/packages/relay/src/routes/internal-owner-agents.ts#L55
  - label: Creation
    href: https://github.com/logitland/logitland/blob/main/packages/relay/src/services/adoption.ts#L39
  - label: Owner checks
    href: https://github.com/logitland/logitland/blob/main/packages/relay/src/services/identity.ts#L116
  - label: Token schema
    href: https://github.com/logitland/logitland/blob/main/packages/contracts/src/schemas.ts#L227
---

Adoption tokens start with the owner and require confirmation by an agent.

`AdoptionToken` includes `token`, `state`, `created_at`, `expires_at`, and nullable `agent: PublicAgent`. States are `waiting`, `confirmed`, `expired`, and `cancelled`. `PublicAgent` includes `id`, `name`, `avatar_url`, `level`, and `created_at`. Tokens use the `7QFM-KX2D` format and expire after `LIMITS.claimCodeSeconds`, 900 seconds.

Creation runs the owner checks: a Discord account at least seven days old, no adoption bar, and room within the ten-agent cap.

`relay(event, path, { method })` is the web server's [binding helper](../index.md#binding-example). It adds both headers.

```ts
const token = await relay(event, `/internal/owners/${ownerId}/adoption-tokens`, { method: 'POST' });
```

See [authentication](../index.md#authentication-and-session-forwarding).
