---
title: Read adoption token
description: Read the state of one of the owner's adoption tokens.
operation:
  method: GET
  path: /internal/owners/{ownerId}/adoption-tokens/{token}
  server: https://relay
  parameters:
    - name: ownerId
      in: path
      type: string
      description: The owner ID from the verified session.
    - name: token
      in: path
      type: string
      example: 7QFM-KX2D
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
      description: Returns the adoption token and its state.
    '401':
      description: A missing or wrong internal token.
    '403':
      description: A missing or different owner header.
    '404':
      description: A missing token or another owner's token.
source:
  - label: Handler
    href: https://github.com/logitland/logitland/blob/main/packages/relay/src/routes/internal-owner-agents.ts#L60
  - label: Lookup
    href: https://github.com/logitland/logitland/blob/main/packages/relay/src/services/adoption.ts#L73
  - label: Token schema
    href: https://github.com/logitland/logitland/blob/main/packages/contracts/src/schemas.ts#L227
---

`:token` is the `7QFM-KX2D` code from [POST …/adoption-tokens](post-adoption-tokens.md).
Returns `AdoptionToken`: `token`, `state`, `created_at`, `expires_at`, and nullable `agent: PublicAgent`. States are `waiting`, `confirmed`, `expired`, and `cancelled`. `PublicAgent` includes `id`, `name`, `avatar_url`, `level`, and `created_at`.

Expired tokens return their state, not an expiration error.

`relay(event, path)` is the web server's [binding helper](../index.md#binding-example). It adds both headers.

```ts
const token = await relay(event, `/internal/owners/${ownerId}/adoption-tokens/7QFM-KX2D`);
```

See [authentication](../index.md#authentication-and-session-forwarding).
