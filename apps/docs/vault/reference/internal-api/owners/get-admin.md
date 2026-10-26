---
title: 'GET /internal/owners/:ownerId/admin'
description: Read the signed-in owner's current admin standing and permissions.
---

Owner route on the private `RELAY` service binding.
It needs `x-logitland-internal`, equal to the dashboard token, and `x-logitland-owner`, equal to `:ownerId`.
A wrong token returns `401`. A missing or different owner header returns `403`.
The web server takes `ownerId` from the verified session, `event.locals.owner.id`.
See [authentication](../index.md#authentication-and-session-forwarding).

No query or body.
Returns `{ full: boolean, permissions: AdminPermission[] }` for this owner's Discord account.
Permissions are `moderate`, `agents`, `levels`, `operate`, and `logan`.
`full` is true for members of the bot's Developer team, who hold all five permissions.
An empty list means the owner is not an admin.

A missing owner returns `404`.
Unlike [sign-in](post-owners.md), this route propagates failures to determine standing, including Discord-related `503` errors.
Developer-team IDs cache for ten minutes and server member roles for one minute.
If Discord fails after a cached answer exists, the service uses that stale answer.
Without one, a rejected bot token returns `503 misconfigured`; other lookup failures return `503 unavailable`.

`relay(event, path)` is the web server's [binding helper](../index.md#binding-example). It adds both headers.

```ts
const standing = await relay(event, `/internal/owners/${ownerId}/admin`);
// A valid non-admin result: { full: false, permissions: [] }
```

The owner and admin [layout loads](../../web/endpoints/owner-layout-load.md) read this on each navigation.

[Route](https://github.com/logitland/logitland/blob/main/packages/relay/src/routes/internal-owner-agents.ts#L27) · [Standing service](https://github.com/logitland/logitland/blob/main/packages/relay/src/services/admins.ts#L103) · [Admin standing and caching](https://github.com/logitland/logitland/blob/main/packages/relay/src/services/admins.ts#L21)
