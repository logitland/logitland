---
title: Lift a moderation strike
description: Remove a strike as the current admin.
operation:
  method: POST
  path: /internal/admin/strikes/{strikeId}/lift
  server: https://relay
  parameters:
    - name: strikeId
      in: path
      type: string
      example: stk_0000000001
    - name: x-logitland-internal
      in: header
      required: true
      type: string
      description: The dashboard token.
    - name: x-logitland-owner
      in: header
      required: true
      type: string
      description: The forwarded owner, who needs the `moderate` admin permission.
  responses:
    '204':
      description: The strike was lifted.
    '404':
      description: The strike could not be removed.
source:
  - label: Routes and optional-body parsing
    href: https://github.com/logitland/logitland/blob/main/packages/relay/src/routes/internal-admin-moderation.ts#L20
  - label: Handler
    href: https://github.com/logitland/logitland/blob/main/packages/relay/src/routes/internal-admin-moderation.ts#L77
  - label: Strike service
    href: https://github.com/logitland/logitland/blob/main/packages/relay/src/services/strikes.ts#L1
---

The strike is lifted with reason `Lifted by an admin`. A pause caused by the strike can end with it.
The mutation handlers deliberately accept no body, `{}`, or malformed JSON as an empty object. Their schemas still validate the resulting object. For example, an empty release body succeeds, but an empty appeal decision fails with `400`.
See [shared binding and error rules](../index.md).

```ts
await relay(event, '/internal/admin/strikes/stk_0000000001/lift', { method: 'POST' });
```
