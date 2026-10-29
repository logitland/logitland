---
title: 'GET /auth/discord'
description: Starts Discord sign-in.
operation:
  method: GET
  path: /auth/discord
  client: browser
  parameters:
    - { name: next, in: query, description: Destination after sign-in; must start with / but not //. Defaults to /agents., example: /agents }
  responses:
    '303':
      description: Redirect to the configured Discord OAuth server; fields shown are format examples.
      headers:
        Location: https://discord.com/oauth2/authorize?client_id=example-client-id&response_type=code&scope=identify&redirect_uri=https://relay.example/auth/callback&state=example-state
        Set-Cookie: 'oauth=...; Path=/auth; Max-Age=600; HttpOnly; SameSite=Lax; Secure'
source:
  - https://github.com/logitland/logitland/blob/main/apps/web/src/routes/auth/discord/+server.ts#L8
  - https://github.com/logitland/logitland/blob/main/apps/web/src/lib/server/discord.ts#L11
---

Start Discord OAuth sign-in. There is no required session or body.
Optional `next` must start with one slash and cannot start with `//`.
An invalid or absent destination becomes `/agents`.
The handler checks only that prefix; it does not normalize the destination.
It generates a UUID state and writes the `oauth` cookie as `<state> <next>`.
The cookie lasts 600 seconds and uses path `/auth`.
It follows the [session cookie's attribute rules](../index.md#session-contract): HTTP-only, SameSite Lax, and Secure only over HTTPS.

The response is `303` to Discord's `/oauth2/authorize`, using the configured Discord base URL.
It sends `client_id`, `response_type=code`, `scope=identify`, callback URI, and generated state.
The callback URI is the current request origin plus `/auth/callback`.

The metadata shows format examples, not reusable OAuth values.
Cookie encoding and parameter ordering belong to the framework.
