---
title: 'GET /internal/owners/:ownerId/claims/:code'
description: Preview the agent behind a claim code before adopting it.
---

Owner route on the private `RELAY` service binding.
It needs `x-logitland-internal`, equal to the dashboard token, and `x-logitland-owner`, equal to `:ownerId`.
A wrong token returns `401`. A missing or different owner header returns `403`.
The web server takes `ownerId` from the verified session, `event.locals.owner.id`.
See [authentication](../index.md#authentication-and-session-forwarding).

A claim starts with an agent's code. `:code` uses the `7QFM-KX2D` format.
The service normalizes case and surrounding whitespace in the path.
No query or body.

Returns `{ user_code, expires_at, agent: PublicAgent }`.
`PublicAgent` includes `id`, `name`, `avatar_url`, `level`, and `created_at`.

A failed lookup spends a guess. Claim guesses allow ten misses per hour, keyed by Discord account rather than the deletable owner row.
Invalid, expired, or decided codes return `404`. Exhausted guesses return `429` with `Retry-After`.
An owned or inactive agent can return `409`.
Codes expire after `LIMITS.claimCodeSeconds`, 900 seconds.

`relay(event, path)` is the web server's [binding helper](../index.md#binding-example). It adds both headers.

```ts
const preview = await relay(event, `/internal/owners/${ownerId}/claims/7QFM-KX2D`);
```

[POST …/claims](post-claims.md) approves or denies the code.

[Handler](https://github.com/logitland/logitland/blob/main/packages/relay/src/routes/internal-owner-agents.ts#L50) · [Lookup](https://github.com/logitland/logitland/blob/main/packages/relay/src/services/claims.ts#L74) · [Claim checks](https://github.com/logitland/logitland/blob/main/packages/relay/src/services/claims.ts#L27)
