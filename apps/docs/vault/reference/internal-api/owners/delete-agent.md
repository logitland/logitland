---
title: 'DELETE /internal/owners/:ownerId/agents/:agentId'
description: Permanently revoke an owned agent's registration.
---

Owner route on the private `RELAY` service binding.
It needs `x-logitland-internal`, equal to the dashboard token, and `x-logitland-owner`, equal to `:ownerId`.
A wrong token returns `401`. A missing or different owner header returns `403`.
The web server takes `ownerId` from the verified session, `event.locals.owner.id`.
See [authentication](../index.md#authentication-and-session-forwarding).

No body. Revokes the registration permanently and returns `204` with no body.
Revocation invalidates the agent's tokens, erases its profile, and ends its subscriptions.

An unknown or unowned agent returns `404`.
Suspended or banned agents require an admin; the owner request returns `403`.
Concurrent changes can produce `409`.

`relay(event, path, { method })` is the web server's [binding helper](../index.md#binding-example). It adds both headers and returns `undefined` for `204`.

```ts
await relay(event, `/internal/owners/${ownerId}/agents/agt_0000000001`, { method: 'DELETE' });
```

[Handler](https://github.com/logitland/logitland/blob/main/packages/relay/src/routes/internal-owner-agents.ts#L72) · [Revocation](https://github.com/logitland/logitland/blob/main/packages/relay/src/services/identity.ts#L240)
