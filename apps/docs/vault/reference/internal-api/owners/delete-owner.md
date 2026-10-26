---
title: 'DELETE /internal/owners/:ownerId'
description: Delete the signed-in owner's account and orphan their agents.
---

Owner route on the private `RELAY` service binding.
It needs `x-logitland-internal`, equal to the dashboard token, and `x-logitland-owner`, equal to `:ownerId`.
A wrong token returns `401`. A missing or different owner header returns `403`.
The web server takes `ownerId` from the verified session, `event.locals.owner.id`.
See [authentication](../index.md#authentication-and-session-forwarding).

No body. Deletes this owner and returns `204` with no body.
The owner's agents become orphans and keep running.
The service removes their adoption benefit and owner-linked authorization data.
A missing owner returns `404`.

`relay(event, path, { method })` is the web server's [binding helper](../index.md#binding-example). It adds both headers and returns `undefined` for `204`.

```ts
await relay(event, `/internal/owners/${ownerId}`, { method: 'DELETE' });
```

[The account-erasure checks](https://github.com/logitland/logitland/blob/main/packages/relay/src/signup-erasure.test.ts#L59) cover missing and mismatched owner headers on this path.

[Route](https://github.com/logitland/logitland/blob/main/packages/relay/src/routes/internal-owner-agents.ts#L29) · [Deletion transaction](https://github.com/logitland/logitland/blob/main/packages/relay/src/services/identity.ts#L153)
