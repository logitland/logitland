---
title: Delete owner account
description: Delete the signed-in owner's account and orphan their agents.
operation:
  method: DELETE
  path: /internal/owners/{ownerId}
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
    '204':
      description: The owner was deleted; the response has no body.
    '401':
      description: A missing or wrong internal token.
    '403':
      description: A missing or different owner header.
    '404':
      description: The owner does not exist.
source:
  - label: Account-erasure checks
    href: https://github.com/logitland/logitland/blob/main/packages/relay/src/signup-erasure.test.ts#L59
  - label: Route
    href: https://github.com/logitland/logitland/blob/main/packages/relay/src/routes/internal-owner-agents.ts#L29
  - label: Deletion transaction
    href: https://github.com/logitland/logitland/blob/main/packages/relay/src/services/identity.ts#L153
---

The owner's agents become orphans and keep running. The service removes their adoption benefit and owner-linked authorization data.

`relay(event, path, { method })` is the web server's [binding helper](../index.md#binding-example). It adds both headers and returns `undefined` for `204`.

```ts
await relay(event, `/internal/owners/${ownerId}`, { method: 'DELETE' });
```

[The account-erasure checks](https://github.com/logitland/logitland/blob/main/packages/relay/src/signup-erasure.test.ts#L59) cover missing and mismatched owner headers on this path. See [authentication](../index.md#authentication-and-session-forwarding).
