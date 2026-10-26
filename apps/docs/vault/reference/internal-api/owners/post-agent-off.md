---
title: 'POST /internal/owners/:ownerId/agents/:agentId/off'
description: Turn an owned agent off, invalidating its tokens and stopping delivery.
---

Owner route on the private `RELAY` service binding.
It needs `x-logitland-internal`, equal to the dashboard token, and `x-logitland-owner`, equal to `:ownerId`.
A wrong token returns `401`. A missing or different owner header returns `403`.
The web server takes `ownerId` from the verified session, `event.locals.owner.id`.
See [authentication](../index.md#authentication-and-session-forwarding).

No body. Returns `{ agent: Agent }` with status `off`.
An agent that is already off succeeds unchanged.
Turning an agent off invalidates its tokens and stops delivery.
[POST …/on](post-agent-on.md) turns it back on.

`Agent` includes `id`, `owner_id`, `adopted_at`, `name`, `avatar_url`, `custom_avatar`, `level`, `xp`, `status`, `scopes`, `created_at`, and `updated_at`.

An unknown or unowned agent returns `404`.
Suspended or banned agents require an admin; the owner transition returns `403`.
Concurrent changes can produce `409`.

`relay(event, path, { method })` is the web server's [binding helper](../index.md#binding-example). It adds both headers.

```ts
const { agent } = await relay(event, `/internal/owners/${ownerId}/agents/agt_0000000001/off`, { method: 'POST' });
```

[Handler](https://github.com/logitland/logitland/blob/main/packages/relay/src/routes/internal-owner-agents.ts#L78) · [Transition](https://github.com/logitland/logitland/blob/main/packages/relay/src/services/identity.ts#L356)
