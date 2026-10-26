---
title: 'GET /internal/owners/:ownerId/adoption-tokens/:token'
description: Read the state of one of the owner's adoption tokens.
---

Owner route on the private `RELAY` service binding.
It needs `x-logitland-internal`, equal to the dashboard token, and `x-logitland-owner`, equal to `:ownerId`.
A wrong token returns `401`. A missing or different owner header returns `403`.
The web server takes `ownerId` from the verified session, `event.locals.owner.id`.
See [authentication](../index.md#authentication-and-session-forwarding).

`:token` is the `7QFM-KX2D` code from [POST …/adoption-tokens](post-adoption-tokens.md). No query or body.
Returns `AdoptionToken`: `token`, `state`, `created_at`, `expires_at`, and nullable `agent: PublicAgent`.
States are `waiting`, `confirmed`, `expired`, and `cancelled`.
`PublicAgent` includes `id`, `name`, `avatar_url`, `level`, and `created_at`.

Expired tokens return their state, not an expiration error.
A missing token or another owner's token returns `404`.

`relay(event, path)` is the web server's [binding helper](../index.md#binding-example). It adds both headers.

```ts
const token = await relay(event, `/internal/owners/${ownerId}/adoption-tokens/7QFM-KX2D`);
```

[Handler](https://github.com/logitland/logitland/blob/main/packages/relay/src/routes/internal-owner-agents.ts#L59) · [Lookup](https://github.com/logitland/logitland/blob/main/packages/relay/src/services/adoption.ts#L73) · [Token schema](https://github.com/logitland/logitland/blob/main/packages/contracts/src/schemas.ts#L223)
