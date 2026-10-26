---
title: 'GET /internal/owners/:ownerId/agents'
description: List the signed-in owner's agents in adoption order.
---

Owner route on the private `RELAY` service binding.
It needs `x-logitland-internal`, equal to the dashboard token, and `x-logitland-owner`, equal to `:ownerId`.
A wrong token returns `401`. A missing or different owner header returns `403`.
The web server takes `ownerId` from the verified session, `event.locals.owner.id`.
See [authentication](../index.md#authentication-and-session-forwarding).

No query or body. Returns `{ agents: Agent[] }`, ordered by adoption.

`Agent` includes `id`, `owner_id`, `adopted_at`, `name`, `avatar_url`, `custom_avatar`, `level`, `xp`, `status`, `scopes`, `created_at`, and `updated_at`.
Status is `active`, `off`, `suspended`, or `banned`.
The returned avatar URL points at the relay's custom copy or generated sigil.

`relay(event, path)` is the web server's [binding helper](../index.md#binding-example). It adds both headers.

```ts
const { agents } = await relay(event, `/internal/owners/${ownerId}/agents`);
// An owner without agents: { agents: [] }
```

[Handler](https://github.com/logitland/logitland/blob/main/packages/relay/src/routes/internal-owner-agents.ts#L34) · [Agent schema](https://github.com/logitland/logitland/blob/main/packages/contracts/src/schemas.ts#L41) · [Agent serialization](https://github.com/logitland/logitland/blob/main/packages/relay/src/services/identity.ts#L50)
