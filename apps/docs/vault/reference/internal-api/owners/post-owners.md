---
title: 'POST /internal/owners'
description: Create or update an owner after Discord sign-in and report whether the person is an admin.
---

The web Worker calls this route through its private `RELAY` service binding after a Discord sign-in.
It needs only `x-logitland-internal`, equal to the dashboard token. No owner session exists yet, so it takes no `x-logitland-owner` header.
A missing or wrong token returns `401 unauthorized`.
See [authentication](../index.md#authentication-and-session-forwarding) and [shared request and error rules](../index.md#shared-request-and-error-rules).

The JSON body contains `discord_user_id` and `username`.
The ID is a Discord snowflake, a string of 17–20 digits. The username trims whitespace and requires 1–64 characters.
The service upserts by Discord ID, preserving the existing owner ID.

The response is `200` with `{ owner: Owner, is_admin: boolean }`.
`Owner` contains `id`, `discord_user_id`, `username`, and `created_at`.
If checking admin standing fails with `503`, sign-in still succeeds with `is_admin: false`.
Other errors propagate. A malformed body returns `400 invalid_request` with field errors.

`relay(event, path, { method, body })` is the web server's [binding helper](../index.md#binding-example). It adds the internal token and serializes `body` as JSON.

```ts
const session = await relay(event, '/internal/owners', {
  method: 'POST',
  body: { discord_user_id: '123456789012345678', username: 'example-person' },
});
```

The [Discord callback](../../web/endpoints/get-auth-callback.md) is the caller.

[Route](https://github.com/logitland/logitland/blob/main/packages/relay/src/routes/internal-owner-agents.ts#L16) · [Upsert](https://github.com/logitland/logitland/blob/main/packages/relay/src/services/identity.ts#L91) · [Schema](https://github.com/logitland/logitland/blob/main/packages/contracts/src/schemas.ts#L986)
