---
title: Cancel adoption token
description: Cancel one of the owner's unused adoption tokens.
operation:
  method: DELETE
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
    '204':
      description: The token was cancelled if it was unused; no response body.
    '401':
      description: A missing or wrong internal token.
    '403':
      description: A missing or different owner header.
    '404':
      description: A missing or unowned token.
source:
  - label: Handler
    href: https://github.com/logitland/logitland/blob/main/packages/relay/src/routes/internal-owner-agents.ts#L62
  - label: Cancellation
    href: https://github.com/logitland/logitland/blob/main/packages/relay/src/services/adoption.ts#L77
---

`:token` is the `7QFM-KX2D` code from [POST …/adoption-tokens](post-adoption-tokens.md). Only unused tokens become `cancelled`; an already used token is unchanged.

`relay(event, path, { method })` is the web server's [binding helper](../index.md#binding-example). It adds both headers and returns `undefined` for `204`.

```ts
await relay(event, `/internal/owners/${ownerId}/adoption-tokens/7QFM-KX2D`, { method: 'DELETE' });
```

See [authentication](../index.md#authentication-and-session-forwarding).
