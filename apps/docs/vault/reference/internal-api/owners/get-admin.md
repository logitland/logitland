---
title: Read admin standing
description: Read the signed-in owner's current admin standing and permissions.
operation:
  method: GET
  path: /internal/owners/{ownerId}/admin
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
      description: Returns this owner's current admin standing.
      example:
        full: false
        permissions: []
    '401':
      description: A missing or wrong internal token.
    '403':
      description: A missing or different owner header.
    '404':
      description: The owner does not exist.
    '503':
      description: Standing lookup is unavailable or misconfigured.
source:
  - label: Route
    href: https://github.com/logitland/logitland/blob/main/packages/relay/src/routes/internal-owner-agents.ts#L27
  - label: Standing service
    href: https://github.com/logitland/logitland/blob/main/packages/relay/src/services/admins.ts#L103
  - label: Admin standing and caching
    href: https://github.com/logitland/logitland/blob/main/packages/relay/src/services/admins.ts#L21
---

Returns `{ full: boolean, permissions: AdminPermission[] }` for this owner's Discord account. Permissions are `moderate`, `agents`, `levels`, `operate`, and `logan`. `full` is true for members of the bot's Developer team, who hold all five permissions. An empty list means the owner is not an admin.

Unlike [sign-in](post-owners.md), this route propagates failures to determine standing, including Discord-related `503` errors. Developer-team IDs cache for ten minutes and server member roles for one minute. If Discord fails after a cached answer exists, the service uses that stale answer. Without one, a rejected bot token returns `503 misconfigured`; other lookup failures return `503 unavailable`.

`relay(event, path)` is the web server's [binding helper](../index.md#binding-example). It adds both headers.

```ts
const standing = await relay(event, `/internal/owners/${ownerId}/admin`);
// A valid non-admin result: { full: false, permissions: [] }
```

The owner and admin [layout loads](../../web/endpoints/owner-layout-load.md) read this on each navigation. See [authentication](../index.md#authentication-and-session-forwarding).
