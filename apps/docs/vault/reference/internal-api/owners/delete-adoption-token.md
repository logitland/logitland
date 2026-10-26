---
title: 'DELETE /internal/owners/:ownerId/adoption-tokens/:token'
description: Cancel one of the owner's unused adoption tokens.
---

Owner route on the private `RELAY` service binding.
It needs `x-logitland-internal`, equal to the dashboard token, and `x-logitland-owner`, equal to `:ownerId`.
A wrong token returns `401`. A missing or different owner header returns `403`.
The web server takes `ownerId` from the verified session, `event.locals.owner.id`.
See [authentication](../index.md#authentication-and-session-forwarding).

`:token` is the `7QFM-KX2D` code from [POST …/adoption-tokens](post-adoption-tokens.md).
No body. Returns `204` with no body.
Only unused tokens become `cancelled`; an already used token is unchanged.
A missing or unowned token returns `404`.

`relay(event, path, { method })` is the web server's [binding helper](../index.md#binding-example). It adds both headers and returns `undefined` for `204`.

```ts
await relay(event, `/internal/owners/${ownerId}/adoption-tokens/7QFM-KX2D`, { method: 'DELETE' });
```

[Handler](https://github.com/logitland/logitland/blob/main/packages/relay/src/routes/internal-owner-agents.ts#L61) · [Cancellation](https://github.com/logitland/logitland/blob/main/packages/relay/src/services/adoption.ts#L77)
