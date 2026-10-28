---
title: Upsert signed-in owner
description: Create or update an owner after Discord sign-in and report whether the person is an admin.
operation:
  method: POST
  path: /internal/owners
  server: https://relay
  parameters:
    - name: x-logitland-internal
      in: header
      required: true
      type: string
      description: The dashboard token.
  requestBody:
    schema:
      type: object
      properties:
        discord_user_id:
          type: string
          pattern: ^\d{17,20}$
        username:
          type: string
          minLength: 1
          maxLength: 64
      required:
        - discord_user_id
        - username
    example:
      discord_user_id: '123456789012345678'
      username: example-person
  responses:
    '200':
      contentType: application/json
      description: Returns the upserted owner and admin standing.
    '400':
      description: A malformed body with field errors.
    '401':
      description: A missing or wrong internal token.
source:
  - label: Route
    href: https://github.com/logitland/logitland/blob/main/packages/relay/src/routes/internal-owner-agents.ts#L16
  - label: Upsert
    href: https://github.com/logitland/logitland/blob/main/packages/relay/src/services/identity.ts#L91
  - label: Schema
    href: https://github.com/logitland/logitland/blob/main/packages/contracts/src/schemas.ts#L986
---

The web Worker calls this route through its private `RELAY` service binding after a Discord sign-in. No owner session exists yet, so it takes no `x-logitland-owner` header.

The ID is a Discord snowflake, a string of 17–20 digits. The username trims whitespace and requires 1–64 characters. The service upserts by Discord ID, preserving the existing owner ID.

The response includes `{ owner: Owner, is_admin: boolean }`. `Owner` contains `id`, `discord_user_id`, `username`, and `created_at`. If checking admin standing fails with `503`, sign-in still succeeds with `is_admin: false`. Other errors propagate.

`relay(event, path, { method, body })` is the web server's [binding helper](../index.md#binding-example). It adds the internal token and serializes `body` as JSON.

```ts
const session = await relay(event, '/internal/owners', {
  method: 'POST',
  body: { discord_user_id: '123456789012345678', username: 'example-person' },
});
```

The [Discord callback](../../web/endpoints/get-auth-callback.md) is the caller. See [authentication](../index.md#authentication-and-session-forwarding) and [shared request and error rules](../index.md#shared-request-and-error-rules).
