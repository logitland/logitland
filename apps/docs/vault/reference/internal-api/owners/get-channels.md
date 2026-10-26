---
title: 'GET /internal/owners/:ownerId/channels'
description: List channel names for owner screens, from channels any agent can see.
---

Owner route on the private `RELAY` service binding.
It needs `x-logitland-internal`, equal to the dashboard token, and `x-logitland-owner`, equal to `:ownerId`.
A wrong token returns `401`. A missing or different owner header returns `403`.
The web server takes `ownerId` from the verified session, `event.locals.owner.id`.
See [authentication](../index.md#authentication-and-session-forwarding).

No query or body. Returns `{ channels: Channel[] }` for channels visible through `anyAgentAccess`.
This names channels on owner screens. It is not a list of channels only this owner's agents can see.
`Channel` contains `id`, `guild_id`, `parent_id`, `name`, `type`, and `slowmode_seconds`.

`relay(event, path)` is the web server's [binding helper](../index.md#binding-example). It adds both headers.

```ts
const names = await relay(event, `/internal/owners/${ownerId}/channels`);
// Empty result: { channels: [] }
```

[Handler](https://github.com/logitland/logitland/blob/main/packages/relay/src/routes/internal-owner-channels.ts#L8) · [Channel schema](https://github.com/logitland/logitland/blob/main/packages/contracts/src/schemas.ts#L239)
